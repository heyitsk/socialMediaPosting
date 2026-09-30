import { prisma } from "../db/client";
import type { PostablePlatform } from "../lib/capabilities";
import { classifyLimitError, type LimitError } from "../lib/limit-errors";
import { logger } from "../lib/logger";
import { APP_WIDE_ACCOUNT_ID, nextDayStart, pausedFailureMessage } from "../lib/posting-limits";
import { removePublishJob } from "../queue/publish-queue";
import { markTargetFailed } from "./post-groups";
import { type Cooldown, releaseSlot, setCooldown } from "./posting-limits";

// When a platform says "too many" or "spam", pause the account and fail what
// was waiting to go to it (websitePlan.md §13.7, §13.9 decision 4). Called by
// the n8n callback and the video-status poller.

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

async function pauseEnd(
  limit: LimitError,
  platform: PostablePlatform,
  platformAccountId: string,
  now: number,
): Promise<Date> {
  const { length } = limit;
  if (length.kind === "FOR") return new Date(now + length.ms);
  if (length.kind === "NEXT_DAY") return new Date(nextDayStart(length.window, now));
  // Room opens when our oldest send in the last 24 h leaves the window. Posts
  // made with other tools aren't in dispatch_slots, so wait at least an hour.
  const oldest = await prisma.dispatchSlot.findFirst({
    where: {
      platform,
      platformAccountId,
      releasedAt: null,
      slotAt: { gt: new Date(now - DAY_MS), lte: new Date(now) },
    },
    orderBy: { slotAt: "asc" },
    select: { slotAt: true },
  });
  if (!oldest) return new Date(now + DAY_MS);
  return new Date(Math.max(oldest.slotAt.getTime() + DAY_MS, now + HOUR_MS));
}

// Fails every target still waiting to go to this account (every account on
// the platform for "*") before the pause ends, and frees its slot. Targets
// already handed to n8n, and ones booked after the pause, are left alone.
// Returns how many were failed.
export async function failWaitingTargets(
  platform: PostablePlatform,
  platformAccountId: string,
  cooldown: Cooldown,
  now = Date.now(),
): Promise<number> {
  const waiting = await prisma.post.findMany({
    where: {
      status: "SCHEDULED",
      connectedAccount:
        platformAccountId === APP_WIDE_ACCOUNT_ID ? { platform } : { platform, platformAccountId },
    },
    select: {
      id: true,
      attempt: true,
      group: { select: { scheduledFor: true } },
      dispatchSlots: { where: { releasedAt: null }, select: { attempt: true, slotAt: true } },
    },
  });

  const message = pausedFailureMessage(cooldown, now);
  let failed = 0;
  for (const post of waiting) {
    const due =
      post.dispatchSlots.find((slot) => slot.attempt === post.attempt)?.slotAt ??
      post.group.scheduledFor;
    if (due && due >= cooldown.until) continue;
    await removePublishJob(post.id, post.attempt);
    if (await markTargetFailed(post.id, platform, message, { attempt: post.attempt })) {
      await releaseSlot(prisma, post.id, post.attempt);
      failed++;
    }
  }
  return failed;
}

// Pauses the account if `raw` is a limit or spam error. Returns the pause
// now in effect (it may end later than this error's, see setCooldown), or
// null if the error isn't one.
export async function pauseForLimitError(input: {
  platform: PostablePlatform;
  platformAccountId: string;
  raw: string;
  sourcePostId?: string;
  now?: number;
}): Promise<Cooldown | null> {
  const { platform, raw, sourcePostId } = input;
  const limit = classifyLimitError(raw, platform);
  if (!limit) return null;

  const now = input.now ?? Date.now();
  const platformAccountId = limit.appWide ? APP_WIDE_ACCOUNT_ID : input.platformAccountId;
  const cooldown = await setCooldown({
    platform,
    platformAccountId,
    until: await pauseEnd(limit, platform, platformAccountId, now),
    reason: limit.reason,
    message: limit.message,
    sourcePostId,
  });
  const failed = await failWaitingTargets(platform, platformAccountId, cooldown, now);
  logger.warn(
    {
      platform,
      platformAccountId,
      until: cooldown.until.toISOString(),
      reason: limit.reason,
      failedWaiting: failed,
    },
    "account paused for a posting limit",
  );
  return cooldown;
}
