import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { MediaType, PostStatus } from "@prisma/client";
import type { Job } from "bullmq";
import type { PublishJobData } from "./publish-queue";

// The in-flight reconciler (websitePlan.md §6), against the dev database. The
// publish queue is replaced so nothing is queued in Redis, and n8n is stubbed.

const DEADLINE_MS = 20 * 60_000;
const GRACE_MS = 5 * 60_000;

const enqueued: string[] = [];
const pendingJobs = new Set<string>();
mock.module("./publish-queue", () => ({
  PUBLISH_QUEUE: "post-publish-test",
  publishJobId: (postId: string, attempt: number) => `publish-${postId}-${attempt}`,
  enqueuePublish: async (postId: string) => {
    enqueued.push(postId);
  },
  enqueueCallbackDeadline: async () => {},
  removePublishJob: async () => true,
  hasPendingPublishJob: async (postId: string) => pendingJobs.has(postId),
  callbackDeadlineMs: () => DEADLINE_MS,
}));
mock.module("../service/n8n", () => ({
  dispatchPost: async () => {},
}));

const { prisma } = await import("../db/client");
const { prepareRetry } = await import("../service/post-groups");
const { publish, reconcileInFlight } = await import("./publish-worker");

const RUN = crypto.randomUUID().slice(0, 8);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

let userId = "";
let workspaceId = "";
let accountId = "";

async function target(
  status: PostStatus,
  dispatchedAt: Date | null,
  mediaType: MediaType = "TEXT",
): Promise<string> {
  const group = await prisma.postGroup.create({
    data: {
      workspaceId,
      createdByUserId: userId,
      contentKind: "TEXT",
      caption: "reconcile test",
      mediaUrls: [],
      idempotencyKey: crypto.randomUUID(),
      status,
    },
  });
  const post = await prisma.post.create({
    data: {
      groupId: group.id,
      workspaceId,
      createdByUserId: userId,
      connectedAccountId: accountId,
      caption: "reconcile test",
      mediaType,
      mediaUrls: [],
      status,
      dispatchedAt,
    },
  });
  return post.id;
}

const load = (postId: string) =>
  prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { logs: true } });

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `reconcile-${RUN}@example.test`, name: "reconcile test" },
  });
  userId = user.id;
  const workspace = await prisma.workspace.create({
    data: { name: `reconcile ${RUN}`, ownerUserId: userId },
  });
  workspaceId = workspace.id;
  const account = await prisma.connectedAccount.create({
    data: {
      workspaceId,
      platform: "FACEBOOK",
      accountName: "reconcile test",
      platformAccountId: `reconcile-${RUN}`,
      encryptedAccessToken: "x",
      keyVersion: 1,
      refreshStrategy: "NONE",
    },
  });
  accountId = account.id;
});

afterAll(async () => {
  const posts = await prisma.post.findMany({ where: { workspaceId }, select: { id: true } });
  const postIds = posts.map((row) => row.id);
  await prisma.postLog.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.dispatchSlot.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  await prisma.postGroup.deleteMany({ where: { workspaceId } });
  await prisma.connectedAccount.deleteMany({ where: { id: accountId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("never sent to n8n", () => {
  test("a lost publish job is queued again", async () => {
    const postId = await target("PROCESSING", null);
    await reconcileInFlight();
    expect(enqueued).toContain(postId);
    expect((await load(postId)).status).toBe("PROCESSING");
  });

  test("a pending publish job is left alone", async () => {
    const postId = await target("PROCESSING", null);
    pendingJobs.add(postId);
    await reconcileInFlight();
    expect(enqueued).not.toContain(postId);
  });
});

describe("sent to n8n", () => {
  test("still within its deadline (and grace), it's left alone", async () => {
    const postId = await target("PROCESSING", minutesAgo((DEADLINE_MS + GRACE_MS) / 60_000 - 1));
    await reconcileInFlight();
    const post = await load(postId);
    expect(post.status).toBe("PROCESSING");
    expect(post.logs).toHaveLength(0);
    expect(enqueued).not.toContain(postId);
  });

  test("past its deadline, it fails like the deadline job and is never re-sent", async () => {
    const postId = await target("PROCESSING", minutesAgo((DEADLINE_MS + GRACE_MS) / 60_000 + 1));
    await reconcileInFlight();
    const post = await load(postId);
    expect(post.status).toBe("FAILED");
    expect(post.logs).toHaveLength(1);
    expect(post.logs[0]?.errorMessage).toStartWith("No result came back from the platform");
    expect(enqueued).not.toContain(postId);

    // Idempotent: a second pass writes nothing more.
    await reconcileInFlight();
    expect((await load(postId)).logs).toHaveLength(1);
  });
});

describe("dispatchedAt", () => {
  test("publish stamps it when handing the target to n8n", async () => {
    const postId = await target("PROCESSING", null);
    const job = { data: { postId, attempt: 1 } } as Job<PublishJobData>;
    const before = Date.now();
    await publish(job, undefined);
    const post = await load(postId);
    expect(post.dispatchedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test("a retry clears it, so the new attempt counts as unsent", async () => {
    const postId = await target("FAILED", minutesAgo(60));
    expect(await prepareRetry(postId)).toBe(2);
    const post = await load(postId);
    expect(post.status).toBe("PROCESSING");
    expect(post.dispatchedAt).toBeNull();
  });
});
