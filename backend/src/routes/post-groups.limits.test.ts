import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Job } from "bullmq";
import type { WorkspaceEnv } from "../middleware/auth";
import type { PublishJobData } from "../queue/publish-queue";

// The posting limiter wired into create, cancel, retry and the publish worker
// (websitePlan.md §13.6), against the dev database. The queues and n8n are
// replaced so nothing is ever queued in Redis or sent — a real publish job
// would be picked up by a running dev backend.

const enqueued: { postId: string; attempt: number; runAt: Date | null | undefined }[] = [];
mock.module("../queue/publish-queue", () => ({
  PUBLISH_QUEUE: "post-publish-test",
  publishJobId: (postId: string, attempt: number) => `publish-${postId}-${attempt}`,
  enqueuePublish: async (postId: string, attempt: number, runAt?: Date | null) => {
    enqueued.push({ postId, attempt, runAt });
  },
  enqueueCallbackDeadline: async () => {},
  removePublishJob: async () => true,
  hasPendingPublishJob: async () => false,
  callbackDeadlineMs: () => 0,
}));
mock.module("../queue/render-queue", () => ({
  RENDER_QUEUE: "media-render-test",
  enqueueRender: async () => {},
}));
mock.module("../service/n8n", () => ({
  dispatchPost: async () => {
    throw new Error("n8n must not be called in tests");
  },
}));

const { OpenAPIHono: Hono } = await import("@hono/zod-openapi");
const { DelayedError } = await import("bullmq");
const { prisma } = await import("../db/client");
const { env } = await import("../lib/env");
const { budgetsFor } = await import("../lib/posting-limits");
const { errorHandler } = await import("../middleware/error-handler");
const { publish } = await import("../queue/publish-worker");
const { markTargetFailed } = await import("../service/post-groups");
const { bookedSlotAt, setCooldown } = await import("../service/posting-limits");
const { postGroupsRoute } = await import("./post-groups");

const RUN = crypto.randomUUID().slice(0, 8);
const HOUR = 60 * 60_000;
const gap = budgetsFor("FACEBOOK", "x", env.POSTING_LIMITS_PROFILE)[0]?.policy.minGapMs ?? 0;

let userId = "";
let workspaceId = "";
let app: OpenAPIHono<WorkspaceEnv>;
const base = () => `/w/${workspaceId}/post-groups`;
const accountIds: string[] = [];
const platformAccountIds: string[] = [];

async function facebookPage(): Promise<string> {
  const platformAccountId = `limits-route-${RUN}-${platformAccountIds.length}`;
  platformAccountIds.push(platformAccountId);
  const account = await prisma.connectedAccount.create({
    data: {
      workspaceId,
      platform: "FACEBOOK",
      accountName: "limits route test",
      platformAccountId,
      encryptedAccessToken: "x",
      keyVersion: 1,
      refreshStrategy: "NONE",
    },
  });
  accountIds.push(account.id);
  return account.id;
}

const platformAccountIdOf = async (connectedAccountId: string) =>
  (await prisma.connectedAccount.findUniqueOrThrow({ where: { id: connectedAccountId } }))
    .platformAccountId;

interface Target {
  id: string;
  connectedAccountId: string;
  status: string;
  attempt: number;
  sendAt: string | null;
  logs: { errorMessage: string | null }[];
}
interface Group {
  id: string;
  status: string;
  targets: Target[];
}
interface Refused {
  targets: { connectedAccountId: string; errors: string[]; nextFreeAt?: string | null }[];
}

async function post(connectedAccountIds: string[], caption: string) {
  const res = await app.request(base(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      contentKind: "TEXT",
      caption,
      targets: connectedAccountIds.map((connectedAccountId) => ({ connectedAccountId })),
    }),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

async function postOk(connectedAccountId: string, caption: string): Promise<Group> {
  const { status, body } = await post([connectedAccountId], caption);
  if (status !== 201) throw new Error(`expected 201, got ${status}: ${JSON.stringify(body)}`);
  return body as Group;
}

function fakeJob(postId: string, attempt: number) {
  const seen: { delayedTo: number | null } = { delayedTo: null };
  const job = {
    data: { postId, attempt } as PublishJobData,
    updateData: async (data: PublishJobData) => {
      job.data = data;
    },
    moveToDelayed: async (timestamp: number) => {
      seen.delayedTo = timestamp;
    },
  };
  return { job: job as unknown as Job<PublishJobData>, seen };
}

const pause = async (connectedAccountId: string, until: Date) =>
  setCooldown({
    platform: "FACEBOOK",
    platformAccountId: await platformAccountIdOf(connectedAccountId),
    until,
    reason: "ABUSE_BLOCK",
    message: "flagged as spam",
  });

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `limits-route-${RUN}@example.test`, name: "limits route test" },
  });
  userId = user.id;
  const workspace = await prisma.workspace.create({
    data: { name: `limits route ${RUN}`, ownerUserId: userId },
  });
  workspaceId = workspace.id;

  app = new Hono<WorkspaceEnv>();
  app.use(async (c, next) => {
    c.set("userId", userId);
    c.set("workspaceId", workspaceId);
    c.set("role", "OWNER");
    await next();
  });
  app.route("/w/:workspaceId/post-groups", postGroupsRoute);
  app.onError(errorHandler);
});

afterAll(async () => {
  const posts = await prisma.post.findMany({ where: { workspaceId }, select: { id: true } });
  const postIds = posts.map((row) => row.id);
  await prisma.postLog.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.dispatchSlot.deleteMany({ where: { postId: { in: postIds } } });
  await prisma.post.deleteMany({ where: { id: { in: postIds } } });
  await prisma.postGroup.deleteMany({ where: { workspaceId } });
  await prisma.accountCooldown.deleteMany({
    where: { platformAccountId: { in: platformAccountIds } },
  });
  await prisma.connectedAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("create", () => {
  test("a second post to the same Page waits for the gap, as SCHEDULED", async () => {
    const page = await facebookPage();
    const first = await postOk(page, "first");
    const [firstTarget] = first.targets;
    expect(firstTarget?.status).toBe("PROCESSING");
    const firstAt = Date.parse(firstTarget?.sendAt ?? "");

    const second = await postOk(page, "second");
    const [secondTarget] = second.targets;
    expect(second.status).toBe("SCHEDULED");
    expect(secondTarget?.status).toBe("SCHEDULED");
    expect(Date.parse(secondTarget?.sendAt ?? "")).toBe(firstAt + gap);

    // Queued to run at the booked time.
    const job = enqueued.find((entry) => entry.postId === secondTarget?.id);
    expect(job?.runAt?.getTime()).toBe(firstAt + gap);
  });

  test("the same caption to the same Page is refused and nothing is created", async () => {
    const page = await facebookPage();
    await postOk(page, "Hello   world");
    const { status, body } = await post([page], "hello world");
    expect(status).toBe(400);
    const [refused] = (body as Refused).targets;
    expect(refused?.connectedAccountId).toBe(page);
    expect(refused?.errors[0]).toContain("same caption and media");
    expect(refused?.nextFreeAt).toBeNull();
    expect(await prisma.post.count({ where: { connectedAccountId: page } })).toBe(1);
  });

  test("a paused account refuses the whole post, with when it's free", async () => {
    const paused = await facebookPage();
    const fine = await facebookPage();
    const until = new Date(Date.now() + 3 * HOUR);
    await pause(paused, until);

    const { status, body } = await post([fine, paused], "all or nothing");
    expect(status).toBe(400);
    const { targets } = body as Refused;
    expect(targets).toHaveLength(1);
    expect(targets[0]?.connectedAccountId).toBe(paused);
    expect(targets[0]?.errors[0]).toContain("paused (flagged as spam)");
    expect(targets[0]?.nextFreeAt).toBe(until.toISOString());
    // The other account got nothing either — no post, no slot.
    expect(await prisma.post.count({ where: { connectedAccountId: fine } })).toBe(0);
    expect(
      await prisma.dispatchSlot.count({
        where: { platformAccountId: await platformAccountIdOf(fine) },
      }),
    ).toBe(0);
  });
});

describe("cancel", () => {
  test("cancelling a pushed-back post releases its slot", async () => {
    const page = await facebookPage();
    await postOk(page, "goes now");
    const waiting = await postOk(page, "waits");
    const [target] = waiting.targets;
    if (!target) throw new Error("no target");

    const res = await app.request(`${base()}/${waiting.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    const cancelled = (await res.json()) as Group;
    expect(cancelled.targets[0]?.status).toBe("CANCELLED");
    expect(await bookedSlotAt(prisma, target.id, 1)).toBeNull();

    // The freed time is available again.
    const next = await postOk(page, "takes the freed slot");
    expect(next.targets[0]?.sendAt).toBe(target.sendAt);
  });
});

describe("retry", () => {
  test("refused while the account is paused, booked once it isn't", async () => {
    const page = await facebookPage();
    const group = await postOk(page, "will fail");
    const [target] = group.targets;
    if (!target) throw new Error("no target");
    await markTargetFailed(target.id, "FACEBOOK", "500 - boom", { attempt: 1 });

    await pause(page, new Date(Date.now() + 2 * HOUR));
    const refused = await app.request(`${base()}/${group.id}/targets/${target.id}/retry`, {
      method: "POST",
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("paused");
    const unchanged = await prisma.post.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.attempt).toBe(1);
    expect(unchanged.status).toBe("FAILED");

    await prisma.accountCooldown.deleteMany({
      where: { platformAccountId: await platformAccountIdOf(page) },
    });
    const retried = await app.request(`${base()}/${group.id}/targets/${target.id}/retry`, {
      method: "POST",
    });
    expect(retried.status).toBe(200);
    const after = ((await retried.json()) as Group).targets[0];
    expect(after?.attempt).toBe(2);
    // Paced after the first attempt's slot, which still counts.
    expect(Date.parse(after?.sendAt ?? "")).toBe(Date.parse(target.sendAt ?? "") + gap);
    expect(
      enqueued.find((entry) => entry.postId === target.id && entry.attempt === 2),
    ).toBeTruthy();
  });
});

describe("publish worker", () => {
  test("fails a waiting post whose account got paused, and frees its slot", async () => {
    const page = await facebookPage();
    const group = await postOk(page, "paused before sending");
    const [target] = group.targets;
    if (!target) throw new Error("no target");
    await pause(page, new Date(Date.now() + 20 * HOUR));

    const { job } = fakeJob(target.id, 1);
    await publish(job, "token");

    const row = await prisma.post.findUniqueOrThrow({
      where: { id: target.id },
      include: { logs: true },
    });
    expect(row.status).toBe("FAILED");
    expect(row.logs[0]?.errorMessage).toStartWith("Not sent: this account is paused");
    expect(await bookedSlotAt(prisma, target.id, 1)).toBeNull();
  });

  test("a job that runs before its slot waits for it", async () => {
    const page = await facebookPage();
    await postOk(page, "first");
    const waiting = await postOk(page, "second");
    const [target] = waiting.targets;
    if (!target?.sendAt) throw new Error("no slot");

    const { job, seen } = fakeJob(target.id, 1);
    await expect(publish(job, "token")).rejects.toBeInstanceOf(DelayedError);
    expect(seen.delayedTo).toBe(Date.parse(target.sendAt));
    const row = await prisma.post.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe("SCHEDULED");
  });
});
