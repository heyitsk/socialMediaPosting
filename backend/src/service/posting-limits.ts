import type { AccountCooldown, CooldownReason, MediaType, Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import type { PostablePlatform } from "../lib/capabilities";
import { env } from "../lib/env";
import {
  type Budget,
  budgetsFor,
  DUPLICATE_WINDOW_MS,
  dayStart,
  nextDayStart,
  nextFreeTimeForAll,
  type Slot,
} from "../lib/posting-limits";

type Tx = Prisma.TransactionClient;

// Books posts into dispatch_slots and keeps account_cooldowns — the database
// side of lib/posting-limits.ts (websitePlan.md §13.5-13.7).

const HOUR_MS = 60 * 60_000;
// No window reaches further back than a 25-hour Pacific day.
const LOOKBACK_MS = 26 * HOUR_MS;

// One lock per platform account, so two posts to the same account book one
// after the other while posts to other accounts don't wait. Transaction-scoped:
// released on commit or rollback, so it can't be left held. Taken in sorted
// order so two transactions needing the same pair (a YouTube channel and the
// app-wide budget) can't deadlock.
async function lockAccounts(
  tx: Tx,
  platform: PostablePlatform,
  accountIds: string[],
): Promise<void> {
  for (const accountId of [...accountIds].sort()) {
    const key = `${platform}:${accountId}`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

function budgetKeys(platform: PostablePlatform, platformAccountId: string): Budget[] {
  return budgetsFor(platform, platformAccountId, env.POSTING_LIMITS_PROFILE);
}

export type Cooldown = Pick<
  AccountCooldown,
  "platform" | "platformAccountId" | "until" | "reason" | "message"
>;

// The pause that ends last among the account's own and the app-wide one
// (YouTube's quotaExceeded pauses every channel), or null.
export async function activeCooldown(
  client: Tx,
  platform: PostablePlatform,
  platformAccountId: string,
  now = new Date(),
): Promise<Cooldown | null> {
  return client.accountCooldown.findFirst({
    where: {
      platform,
      platformAccountId: {
        in: budgetKeys(platform, platformAccountId).map((b) => b.platformAccountId),
      },
      until: { gt: now },
    },
    orderBy: { until: "desc" },
    select: { platform: true, platformAccountId: true, until: true, reason: true, message: true },
  });
}

// Pauses an account until `until`. A pause is never shortened: if one ending
// later is already set, it stays and is returned.
export async function setCooldown(input: {
  platform: PostablePlatform;
  platformAccountId: string;
  until: Date;
  reason: CooldownReason;
  message: string;
  sourcePostId?: string | null;
}): Promise<Cooldown> {
  const { platform, platformAccountId, ...data } = input;
  return prisma.$transaction(async (tx) => {
    await lockAccounts(tx, platform, [platformAccountId]);
    const key = { platform_platformAccountId: { platform, platformAccountId } };
    const existing = await tx.accountCooldown.findUnique({ where: key });
    if (existing && existing.until >= data.until) return existing;
    return tx.accountCooldown.upsert({
      where: key,
      create: { platform, platformAccountId, ...data },
      update: data,
    });
  });
}

async function loadSlots(
  tx: Tx,
  platform: PostablePlatform,
  budgets: Budget[],
  from: number,
): Promise<Map<string, Slot[]>> {
  const rows = await tx.dispatchSlot.findMany({
    where: {
      platform,
      platformAccountId: { in: budgets.map((b) => b.platformAccountId) },
      releasedAt: null,
      slotAt: { gte: new Date(from - LOOKBACK_MS) },
    },
    select: { platformAccountId: true, slotAt: true, cost: true },
  });
  const byAccount = new Map<string, Slot[]>(budgets.map((b) => [b.platformAccountId, []]));
  for (const row of rows) {
    byAccount.get(row.platformAccountId)?.push({ at: row.slotAt.getTime(), cost: row.cost });
  }
  return byAccount;
}

export interface SlotRequest {
  platform: PostablePlatform;
  platformAccountId: string;
  postId: string;
  attempt: number;
  mediaType: MediaType;
  // Files in the post — LinkedIn carousels cost per image.
  mediaCount: number;
  contentHash: string;
  // Now, or the scheduled time.
  earliest: Date;
  // Nothing is booked past this; the next free time is returned instead.
  latest: Date;
}

export type SlotResult =
  | { ok: true; slotAt: Date }
  // The same content went to this account within 24 h (another post).
  | { ok: false; reason: "DUPLICATE"; duplicateAt: Date }
  // No time between earliest and latest. nextFreeAt is null if there's none
  // within a week (or the post alone is over the daily cap).
  | { ok: false; reason: "NO_SLOT"; nextFreeAt: Date | null; cooldown: Cooldown | null };

// Books the earliest time this target may go out. Must run inside a
// transaction (the one creating the post, or its own): the lock only lasts
// until that transaction ends, and outside one it would end immediately.
// Booking the same post and attempt again returns the existing slot.
export async function reserveSlot(tx: Tx, request: SlotRequest): Promise<SlotResult> {
  const { platform, platformAccountId, postId, attempt } = request;
  const budgets = budgetKeys(platform, platformAccountId);
  await lockAccounts(
    tx,
    platform,
    budgets.map((b) => b.platformAccountId),
  );

  const existing = await tx.dispatchSlot.findFirst({
    where: { postId, attempt, platformAccountId, releasedAt: null },
    select: { slotAt: true },
  });
  if (existing) return { ok: true, slotAt: existing.slotAt };

  const earliest = request.earliest.getTime();
  // Earlier attempts of this same post don't count — a retry sends the same
  // content on purpose.
  const duplicate = await tx.dispatchSlot.findFirst({
    where: {
      platform,
      platformAccountId,
      contentHash: request.contentHash,
      releasedAt: null,
      postId: { not: postId },
      slotAt: {
        gt: new Date(earliest - DUPLICATE_WINDOW_MS),
        lt: new Date(earliest + DUPLICATE_WINDOW_MS),
      },
    },
    orderBy: { slotAt: "desc" },
    select: { slotAt: true },
  });
  if (duplicate) return { ok: false, reason: "DUPLICATE", duplicateAt: duplicate.slotAt };

  const cooldown = await activeCooldown(tx, platform, platformAccountId, request.earliest);
  const start = Math.max(earliest, cooldown?.until.getTime() ?? 0);
  const slots = await loadSlots(tx, platform, budgets, start);
  const costs = budgets.map((b) => b.policy.cost(request.mediaType, request.mediaCount));
  const at = nextFreeTimeForAll(
    budgets.map((b, i) => ({
      policy: b.policy,
      slots: slots.get(b.platformAccountId) ?? [],
      cost: costs[i] ?? 1,
    })),
    start,
  );
  if (at === null || at > request.latest.getTime()) {
    return {
      ok: false,
      reason: "NO_SLOT",
      nextFreeAt: at === null ? null : new Date(at),
      cooldown,
    };
  }

  const slotAt = new Date(at);
  await tx.dispatchSlot.createMany({
    data: budgets.map((b, i) => ({
      platform,
      platformAccountId: b.platformAccountId,
      postId,
      attempt,
      cost: costs[i] ?? 1,
      slotAt,
      contentHash: request.contentHash,
    })),
  });
  return { ok: true, slotAt };
}

// When this attempt is booked to go out, or null if it has no slot (posts
// from before the limiter, or released).
export async function bookedSlotAt(
  client: Tx,
  postId: string,
  attempt: number,
): Promise<Date | null> {
  const slot = await client.dispatchSlot.findFirst({
    where: { postId, attempt, releasedAt: null },
    select: { slotAt: true },
  });
  return slot?.slotAt ?? null;
}

// For a target that failed or was cancelled before it reached n8n: the
// platform never saw it, so it stops counting. Returns whether a slot was
// released.
export async function releaseSlot(client: Tx, postId: string, attempt: number): Promise<boolean> {
  const { count } = await client.dispatchSlot.updateMany({
    where: { postId, attempt, releasedAt: null },
    data: { releasedAt: new Date() },
  });
  return count > 0;
}

export interface AccountUsage {
  // Cost already sent in the current window (posts, or LinkedIn API calls).
  used: number;
  // Booked for later.
  upcoming: number;
  cap: number;
  window: Budget["policy"]["window"];
  // Calendar windows: the next midnight. Rolling: when the oldest send in
  // the last 24 h leaves it. Null if nothing has been sent in it.
  resetsAt: Date | null;
  // Earliest time a one-cost post (text, single image) could go out.
  nextFreeAt: Date | null;
  cooldown: Cooldown | null;
}

// For the dashboard and composer (websitePlan.md §13.8). The account's own
// budget only — the app-wide one isn't shown.
export async function accountUsage(
  platform: PostablePlatform,
  platformAccountId: string,
  now = new Date(),
): Promise<AccountUsage> {
  const budgets = budgetKeys(platform, platformAccountId);
  const [own] = budgets;
  if (!own) throw new Error(`No posting budget for ${platform}`);
  const nowMs = now.getTime();

  const [cooldown, slots] = await Promise.all([
    activeCooldown(prisma, platform, platformAccountId, now),
    loadSlots(prisma, platform, budgets, nowMs),
  ]);
  const ownSlots = slots.get(platformAccountId) ?? [];
  const { window } = own.policy;
  // Same bounds as fitsAt: the last 24 h exclusive, or since midnight inclusive.
  const inWindow =
    window === "ROLLING_24H"
      ? (at: number) => at > nowMs - 24 * HOUR_MS
      : (at: number) => at >= dayStart(window, nowMs);
  const sent = ownSlots.filter((slot) => inWindow(slot.at) && slot.at <= nowMs);
  const sum = (list: Slot[]) => list.reduce((total, slot) => total + slot.cost, 0);

  let resetsAt: number | null;
  if (window !== "ROLLING_24H") resetsAt = nextDayStart(window, nowMs);
  else if (sent.length === 0) resetsAt = null;
  else resetsAt = Math.min(...sent.map((slot) => slot.at)) + 24 * HOUR_MS;

  const start = Math.max(nowMs, cooldown?.until.getTime() ?? 0);
  const nextFreeAt = nextFreeTimeForAll(
    budgets.map((b) => ({
      policy: b.policy,
      slots: slots.get(b.platformAccountId) ?? [],
      cost: 1,
    })),
    start,
  );

  return {
    used: sum(sent),
    upcoming: sum(ownSlots.filter((slot) => slot.at > nowMs)),
    cap: own.policy.perDay,
    window,
    resetsAt: resetsAt === null ? null : new Date(resetsAt),
    nextFreeAt: nextFreeAt === null ? null : new Date(nextFreeAt),
    cooldown,
  };
}
