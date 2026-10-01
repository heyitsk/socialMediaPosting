import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaType, Platform } from "@prisma/client";
import { prisma } from "../db/client";
import type { PostablePlatform } from "../lib/capabilities";
import { env } from "../lib/env";
import { APP_WIDE_ACCOUNT_ID, budgetsFor, fitsAt } from "../lib/posting-limits";
import {
  accountUsage,
  activeCooldown,
  bookedSlotAt,
  releaseSlot,
  reserveSlot,
  type SlotRequest,
  setCooldown,
} from "./posting-limits";

// Runs against the dev database (DATABASE_URL). Every row it makes uses the
// ids below and is deleted in afterAll. Each test uses its own platform
// account id, so tests don't see each other's slots.

const RUN = crypto.randomUUID().slice(0, 8);
const MIN = 60_000;
const HOUR = 60 * MIN;

let userId = "";
let workspaceId = "";
let connectedAccountId = "";
let groupId = "";
const postIds: string[] = [];
const accountIds: string[] = [];

function account(): string {
  const id = `limits-test-${RUN}-${accountIds.length}`;
  accountIds.push(id);
  return id;
}

async function newPost(): Promise<string> {
  const post = await prisma.post.create({
    data: {
      groupId,
      workspaceId,
      createdByUserId: userId,
      connectedAccountId,
      caption: "limits test",
      mediaType: "TEXT",
      mediaUrls: [],
    },
    select: { id: true },
  });
  postIds.push(post.id);
  return post.id;
}

const policyOf = (platform: PostablePlatform, accountId: string) =>
  budgetsFor(platform, accountId, env.POSTING_LIMITS_PROFILE)[0]?.policy;

function request(
  platform: PostablePlatform,
  platformAccountId: string,
  postId: string,
  earliest: number,
  over: Partial<SlotRequest> = {},
): SlotRequest {
  return {
    platform,
    platformAccountId,
    postId,
    attempt: 1,
    mediaType: "TEXT" as MediaType,
    mediaCount: 0,
    contentHash: crypto.randomUUID(),
    earliest: new Date(earliest),
    latest: new Date(earliest + HOUR),
    ...over,
  };
}

const reserve = (req: SlotRequest) => prisma.$transaction((tx) => reserveSlot(tx, req));

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `limits-test-${RUN}@example.test`, name: "limits test" },
  });
  userId = user.id;
  const workspace = await prisma.workspace.create({
    data: { name: `limits test ${RUN}`, ownerUserId: userId },
  });
  workspaceId = workspace.id;
  const connected = await prisma.connectedAccount.create({
    data: {
      workspaceId,
      platform: "FACEBOOK",
      accountName: "limits test",
      platformAccountId: `limits-test-${RUN}`,
      encryptedAccessToken: "x",
      keyVersion: 1,
      refreshStrategy: "NONE",
    },
  });
  connectedAccountId = connected.id;
  const group = await prisma.postGroup.create({
    data: {
      workspaceId,
      createdByUserId: userId,
      contentKind: "TEXT",
      caption: "limits test",
      mediaUrls: [],
      idempotencyKey: `limits-test-${RUN}`,
    },
  });
  groupId = group.id;
});

afterAll(async () => {
  await prisma.dispatchSlot.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.accountCooldown.deleteMany({ where: { platformAccountId: { in: accountIds } } });
  await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  await prisma.postGroup.deleteMany({ where: { id: groupId } });
  await prisma.connectedAccount.deleteMany({ where: { id: connectedAccountId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("reserveSlot", () => {
  test("books now, then the next post after the gap", async () => {
    const id = account();
    const gap = policyOf("FACEBOOK", id)?.minGapMs ?? 0;
    const now = Date.now();
    const first = await reserve(request("FACEBOOK", id, await newPost(), now));
    const second = await reserve(request("FACEBOOK", id, await newPost(), now));
    expect(first).toEqual({ ok: true, slotAt: new Date(now) });
    expect(second).toEqual({ ok: true, slotAt: new Date(now + gap) });
  });

  test("booking the same attempt again returns the same slot", async () => {
    const id = account();
    const postId = await newPost();
    const now = Date.now();
    const first = await reserve(request("FACEBOOK", id, postId, now));
    const again = await reserve(request("FACEBOOK", id, postId, now + 5 * MIN));
    expect(again).toEqual(first);
    expect(await prisma.dispatchSlot.count({ where: { postId } })).toBe(1);
  });

  test("the same content to the same account is a duplicate, unless it's a retry", async () => {
    const id = account();
    const postId = await newPost();
    const now = Date.now();
    const contentHash = `hash-${RUN}`;
    await reserve(request("FACEBOOK", id, postId, now, { contentHash }));

    const other = await reserve(
      request("FACEBOOK", id, await newPost(), now + HOUR, { contentHash }),
    );
    expect(other).toEqual({ ok: false, reason: "DUPLICATE", duplicateAt: new Date(now) });

    const retry = await reserve(
      request("FACEBOOK", id, postId, now + HOUR, { contentHash, attempt: 2 }),
    );
    expect(retry.ok).toBe(true);

    // Another account may get the same content.
    const elsewhere = await reserve(
      request("FACEBOOK", account(), await newPost(), now, { contentHash }),
    );
    expect(elsewhere.ok).toBe(true);
  });

  test("nothing is booked past `latest`; the next free time comes back", async () => {
    const id = account();
    const gap = policyOf("FACEBOOK", id)?.minGapMs ?? 0;
    const now = Date.now();
    await reserve(request("FACEBOOK", id, await newPost(), now));
    const postId = await newPost();
    const result = await reserve(
      request("FACEBOOK", id, postId, now, { latest: new Date(now + MIN) }),
    );
    expect(result).toEqual({
      ok: false,
      reason: "NO_SLOT",
      nextFreeAt: new Date(now + gap),
      cooldown: null,
    });
    expect(await bookedSlotAt(prisma, postId, 1)).toBeNull();
  });

  test("a released slot stops counting", async () => {
    const id = account();
    const now = Date.now();
    const postId = await newPost();
    await reserve(request("FACEBOOK", id, postId, now));
    expect(await bookedSlotAt(prisma, postId, 1)).toEqual(new Date(now));
    expect(await releaseSlot(prisma, postId, 1)).toBe(true);
    expect(await releaseSlot(prisma, postId, 1)).toBe(false);
    expect(await bookedSlotAt(prisma, postId, 1)).toBeNull();

    const next = await reserve(request("FACEBOOK", id, await newPost(), now));
    expect(next).toEqual({ ok: true, slotAt: new Date(now) });
  });

  test("the daily cap: LinkedIn counts API calls", async () => {
    const id = account();
    const policy = policyOf("LINKEDIN", id);
    if (!policy) throw new Error("no LinkedIn policy");
    // A carousel using all but a call or two of the day (1 + 2 per image),
    // then an image post (3 calls) that no longer fits today.
    const images = Math.floor((policy.perDay - 1) / 2);
    const now = Date.now();
    const carousel = await reserve(
      request("LINKEDIN", id, await newPost(), now, { mediaType: "CAROUSEL", mediaCount: images }),
    );
    expect(carousel.ok).toBe(true);
    const image = await reserve(
      request("LINKEDIN", id, await newPost(), now, {
        mediaType: "IMAGE",
        mediaCount: 1,
        latest: new Date(now + 7 * 24 * HOUR),
      }),
    );
    if (!image.ok) throw new Error(`expected a booking, got ${image.reason}`);
    // Pushed to the next UTC day.
    const nextUtcMidnight = Math.floor(now / (24 * HOUR)) * 24 * HOUR + 24 * HOUR;
    expect(image.slotAt.getTime()).toBeGreaterThanOrEqual(nextUtcMidnight);
  });

  test("YouTube books the channel and the app-wide budget", async () => {
    const id = account();
    const postId = await newPost();
    const result = await reserve(request("YOUTUBE", id, postId, Date.now()));
    expect(result.ok).toBe(true);
    const rows = await prisma.dispatchSlot.findMany({
      where: { postId },
      select: { platformAccountId: true },
      orderBy: { platformAccountId: "asc" },
    });
    expect(rows.map((row) => row.platformAccountId)).toEqual([APP_WIDE_ACCOUNT_ID, id]);
  });

  test("posts racing for one account never break its rules", async () => {
    const id = account();
    const policy = policyOf("INSTAGRAM", id);
    if (!policy) throw new Error("no Instagram policy");
    const now = Date.now();
    const posts = await Promise.all(Array.from({ length: 8 }, () => newPost()));
    // All at once, each in its own transaction, all asking for "now".
    const results = await Promise.all(
      posts.map((postId) => reserve(request("INSTAGRAM", id, postId, now))),
    );

    const booked = results.flatMap((result) => (result.ok ? [result.slotAt.getTime()] : []));
    expect(booked.length).toBeGreaterThan(0);
    expect(new Set(booked).size).toBe(booked.length);
    for (const at of booked) {
      const others = booked
        .filter((other) => other !== at)
        .map((other) => ({ at: other, cost: 1 }));
      expect(fitsAt(policy, others, at, 1)).toBe(true);
    }
    // The ones that didn't fit within the hour were told when they could.
    for (const result of results) {
      if (!result.ok) expect(result.reason).toBe("NO_SLOT");
    }
  });
});

describe("cooldowns", () => {
  test("a pause pushes bookings past its end and is never shortened", async () => {
    const id = account();
    const now = Date.now();
    const until = new Date(now + 2 * HOUR);
    await setCooldown({
      platform: "INSTAGRAM",
      platformAccountId: id,
      until,
      reason: "ABUSE_BLOCK",
      message: "flagged as spam",
    });
    const shorter = await setCooldown({
      platform: "INSTAGRAM",
      platformAccountId: id,
      until: new Date(now + HOUR),
      reason: "RATE_LIMIT",
      message: "throttled",
    });
    expect(shorter.until).toEqual(until);
    expect(shorter.reason).toBe("ABUSE_BLOCK");

    const active = await activeCooldown(prisma, "INSTAGRAM", id, new Date(now));
    expect(active?.until).toEqual(until);
    expect(await activeCooldown(prisma, "INSTAGRAM", id, new Date(until.getTime() + 1))).toBeNull();

    const blocked = await reserve(request("INSTAGRAM", id, await newPost(), now));
    expect(blocked.ok).toBe(false);
    if (blocked.ok || blocked.reason !== "NO_SLOT") throw new Error("expected NO_SLOT");
    expect(blocked.nextFreeAt).toEqual(until);
    expect(blocked.cooldown?.reason).toBe("ABUSE_BLOCK");

    const later = await reserve(
      request("INSTAGRAM", id, await newPost(), now, { latest: new Date(now + 3 * HOUR) }),
    );
    expect(later).toEqual({ ok: true, slotAt: until });
  });

  test("an app-wide YouTube pause applies to every channel", async () => {
    // Uses the real "*" key, so the pause lasts only a few seconds and the
    // row is put back as it was afterwards. Skipped if a real pause is on.
    const id = account();
    const now = Date.now();
    const until = new Date(now + 5_000);
    const existing = await prisma.accountCooldown.findUnique({
      where: {
        platform_platformAccountId: {
          platform: "YOUTUBE" as Platform,
          platformAccountId: APP_WIDE_ACCOUNT_ID,
        },
      },
    });
    if (existing && existing.until > new Date(now)) return; // A real pause is on; leave it alone.
    await setCooldown({
      platform: "YOUTUBE",
      platformAccountId: APP_WIDE_ACCOUNT_ID,
      until,
      reason: "QUOTA",
      message: "quota used up",
    });
    try {
      const active = await activeCooldown(prisma, "YOUTUBE", id, new Date(now));
      expect(active?.platformAccountId).toBe(APP_WIDE_ACCOUNT_ID);
    } finally {
      await prisma.accountCooldown.delete({
        where: {
          platform_platformAccountId: {
            platform: "YOUTUBE",
            platformAccountId: APP_WIDE_ACCOUNT_ID,
          },
        },
      });
      if (existing) await prisma.accountCooldown.create({ data: existing });
    }
  });
});

describe("accountUsage", () => {
  test("counts what was sent in the window and what's booked", async () => {
    const id = account();
    const policy = policyOf("THREADS", id);
    const now = Date.now();
    await reserve(
      request("THREADS", id, await newPost(), now - 2 * HOUR, { latest: new Date(now) }),
    );
    await reserve(request("THREADS", id, await newPost(), now + HOUR));

    const usage = await accountUsage("THREADS", id, new Date(now));
    expect(usage.used).toBe(1);
    expect(usage.upcoming).toBe(1);
    expect(usage.cap).toBe(policy?.perDay ?? 0);
    expect(usage.window).toBe("ROLLING_24H");
    expect(usage.resetsAt).toEqual(new Date(now - 2 * HOUR + 24 * HOUR));
    expect(usage.nextFreeAt).toEqual(new Date(now));
    expect(usage.cooldown).toBeNull();
  });
});
