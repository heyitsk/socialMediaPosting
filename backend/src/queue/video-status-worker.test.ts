import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Platform } from "@prisma/client";
import type { Job } from "bullmq";

// The video-status poller when the status check itself throws (websitePlan.md
// §6), against the dev database. The queue is replaced so nothing touches
// Redis, and Facebook's status call is stubbed per test.

let facebookStatus: () => Promise<string> = async () => "processing";
const realFacebook = await import("../lib/facebook");
mock.module("../lib/facebook", () => ({
  ...realFacebook,
  getVideoStatus: () => facebookStatus(),
}));
mock.module("./video-status-queue", () => ({
  VIDEO_STATUS_QUEUE: "video-status-test",
  enqueueVideoStatusPoll: async () => {},
  pollBackoffStrategy: () => 0,
  pollTimeoutMs: () => 0,
}));

const { prisma } = await import("../db/client");
const { encrypt } = await import("../lib/crypto");
const { friendlyPlatformError } = await import("../lib/platform-error");
const { onVideoPollFailed, pollVideoStatus } = await import("./video-status-worker");

const RUN = crypto.randomUUID().slice(0, 8);
const ATTEMPTS = 30;

let userId = "";
let workspaceId = "";
const accountIds: string[] = [];

async function processingVideo(platform: Platform): Promise<string> {
  const keyVersion = 1;
  const account = await prisma.connectedAccount.create({
    data: {
      workspaceId,
      platform,
      accountName: "video poll test",
      platformAccountId: `video-poll-${RUN}-${accountIds.length}`,
      encryptedAccessToken: encrypt("token", keyVersion),
      keyVersion,
      // YouTube: expired, with no refresh token to renew it.
      refreshStrategy: platform === "YOUTUBE" ? "ON_DEMAND" : "NONE",
      tokenExpiresAt: platform === "YOUTUBE" ? new Date(0) : null,
    },
  });
  accountIds.push(account.id);
  const group = await prisma.postGroup.create({
    data: {
      workspaceId,
      createdByUserId: userId,
      contentKind: "VIDEO",
      caption: "video poll test",
      mediaUrls: [],
      idempotencyKey: crypto.randomUUID(),
    },
  });
  const post = await prisma.post.create({
    data: {
      groupId: group.id,
      workspaceId,
      createdByUserId: userId,
      connectedAccountId: account.id,
      caption: "video poll test",
      mediaType: "VIDEO",
      mediaUrls: [],
      status: "PROCESSING",
    },
  });
  return post.id;
}

// attemptsMade counts finished attempts: 0 while the first one runs, and
// already including the failed one by the time "failed" is emitted.
function fakeJob(postId: string, platform: Platform, attemptsMade: number) {
  return {
    id: `video-${postId}`,
    data: { postId, platform, platformPostId: "video-123", mediaId: "video-123" },
    attemptsMade,
    opts: { attempts: ATTEMPTS },
  } as unknown as Job<Parameters<typeof pollVideoStatus>[0]["data"]>;
}

const target = (postId: string) =>
  prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { logs: true, group: true } });

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `video-poll-${RUN}@example.test`, name: "video poll test" },
  });
  userId = user.id;
  const workspace = await prisma.workspace.create({
    data: { name: `video poll ${RUN}`, ownerUserId: userId },
  });
  workspaceId = workspace.id;
});

afterAll(async () => {
  const posts = await prisma.post.findMany({ where: { workspaceId }, select: { id: true } });
  const postIds = posts.map((row) => row.id);
  await prisma.postLog.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  await prisma.postGroup.deleteMany({ where: { workspaceId } });
  await prisma.connectedAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("status check throws", () => {
  test("before the last attempt, it rethrows so BullMQ retries", async () => {
    const postId = await processingVideo("FACEBOOK");
    facebookStatus = async () => {
      throw new Error("read ECONNRESET");
    };
    await expect(pollVideoStatus(fakeJob(postId, "FACEBOOK", 0))).rejects.toThrow("ECONNRESET");
    expect((await target(postId)).status).toBe("PROCESSING");
  });

  test("on the last attempt, the target fails with the real reason", async () => {
    const postId = await processingVideo("FACEBOOK");
    facebookStatus = async () => {
      throw new Error("read ECONNRESET");
    };
    await pollVideoStatus(fakeJob(postId, "FACEBOOK", ATTEMPTS - 1));

    const post = await target(postId);
    expect(post.status).toBe("FAILED");
    expect(post.group.status).toBe("FAILED");
    expect(post.logs).toHaveLength(1);
    expect(post.logs[0]?.platformPostId).toBe("video-123");
    expect(post.logs[0]?.errorMessage).toContain("ECONNRESET");
    expect(friendlyPlatformError(post.logs[0]?.errorMessage ?? "", "FACEBOOK")).toBe(
      "The connection to the platform dropped while posting — try again.",
    );
  });

  test("a revoked token fails on the first attempt", async () => {
    const postId = await processingVideo("YOUTUBE");
    await pollVideoStatus(fakeJob(postId, "YOUTUBE", 0));

    const post = await target(postId);
    expect(post.status).toBe("FAILED");
    expect(post.logs[0]?.platformPostId).toBe("video-123");
    expect(friendlyPlatformError(post.logs[0]?.errorMessage ?? "", "YOUTUBE")).toBe(
      "This account's access has expired — reconnect it on the Dashboard.",
    );
  });

  test("a later successful check still publishes", async () => {
    const postId = await processingVideo("FACEBOOK");
    facebookStatus = async () => {
      throw new Error("read ECONNRESET");
    };
    await expect(pollVideoStatus(fakeJob(postId, "FACEBOOK", 0))).rejects.toThrow();
    facebookStatus = async () => "ready";
    await pollVideoStatus(fakeJob(postId, "FACEBOOK", 1));

    const post = await target(postId);
    expect(post.status).toBe("PUBLISHED");
    expect(post.logs.map((log) => log.status)).toEqual(["SUCCESS"]);
  });
});

describe("failed listener", () => {
  test("ignores attempts that BullMQ will retry", async () => {
    const postId = await processingVideo("FACEBOOK");
    await onVideoPollFailed(fakeJob(postId, "FACEBOOK", 1), new Error("database is down"));
    expect((await target(postId)).status).toBe("PROCESSING");
  });

  test("fails the target after the last attempt", async () => {
    const postId = await processingVideo("FACEBOOK");
    await onVideoPollFailed(fakeJob(postId, "FACEBOOK", ATTEMPTS), new Error("database is down"));

    const post = await target(postId);
    expect(post.status).toBe("FAILED");
    expect(post.logs[0]?.errorMessage).toContain("database is down");
  });

  test("leaves a target that already finished alone", async () => {
    const postId = await processingVideo("FACEBOOK");
    facebookStatus = async () => "ready";
    await pollVideoStatus(fakeJob(postId, "FACEBOOK", 0));
    await onVideoPollFailed(fakeJob(postId, "FACEBOOK", ATTEMPTS), new Error("late crash"));

    const post = await target(postId);
    expect(post.status).toBe("PUBLISHED");
    expect(post.logs).toHaveLength(1);
  });
});
