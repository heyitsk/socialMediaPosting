import { DelayedError, type Job, Worker } from "bullmq";
import { prisma } from "../db/client";
import { reconnectReason } from "../lib/capabilities";
import { mediaUrlsForDispatch } from "../service/media";
import { dispatchPost } from "../service/n8n";
import {
  markTargetCancelled,
  markTargetFailed,
  markTargetProcessing,
} from "../service/post-groups";
import { redisConnection } from "./connection";
import {
  enqueueCallbackDeadline,
  enqueuePublish,
  hasPendingPublishJob,
  PUBLISH_QUEUE,
  type PublishJobData,
} from "./publish-queue";

// Each job is one quick HTTP call to n8n (the workflows respond on receipt),
// so a group's targets — up to this many — go out in parallel.
const CONCURRENCY = 10;

// A scheduled post that fires this late (backend was down) is failed instead
// of posting stale content. Manual retries skip the check — the user chose
// to send it now. websitePlan.md §10.6.
const MAX_SCHEDULE_LATENESS_MS = 60 * 60_000;

// Cropped/padded media is rendered right after the post is created, so it's
// usually ready long before sending. If not, the publish re-checks this often
// and gives up after this long (websitePlan.md §12.5).
const RENDER_POLL_MS = 15_000;
const IMAGE_RENDER_WAIT_MS = 10 * 60_000;
const VIDEO_RENDER_WAIT_MS = 45 * 60_000;

async function publish(job: Job<PublishJobData>, token?: string): Promise<void> {
  const { postId, attempt, waitingSince } = job.data;
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      connectedAccount: true,
      group: {
        include: {
          workspace: { select: { deletedAt: true } },
          media: { orderBy: { position: "asc" }, select: { id: true, key: true, status: true } },
        },
      },
      renditions: {
        select: {
          mediaAssetId: true,
          rendition: { select: { key: true, status: true, contentType: true, error: true } },
        },
      },
    },
  });
  // Superseded by a retry, or already handled (cancelled, duplicate job).
  if (!post || post.attempt !== attempt) return;
  if (post.status !== "SCHEDULED" && post.status !== "PROCESSING") return;

  const { group, connectedAccount: account } = post;
  const platform = account.platform;

  // Cancelling only stops targets not yet sent — a manual retry of one that
  // failed before the cancel still goes out.
  if (post.status === "SCHEDULED" && (group.cancelledAt || group.workspace.deletedAt)) {
    await markTargetCancelled(postId);
    return;
  }
  // Not while waiting for renders — that wait has its own limit below.
  if (
    attempt === 1 &&
    waitingSince === undefined &&
    group.scheduledFor &&
    Date.now() - group.scheduledFor.getTime() > MAX_SCHEDULE_LATENESS_MS
  ) {
    await markTargetFailed(
      postId,
      platform,
      "Missed its scheduled time (the server was unavailable) — retry to post it now",
      { attempt },
    );
    return;
  }

  // Scheduled posts are re-checked at send time: the account may have been
  // disconnected, or its token may have lapsed, since the post was created.
  if (account.disconnectedAt) {
    await markTargetFailed(
      postId,
      platform,
      "The account was disconnected — reconnect it and retry",
      { attempt },
    );
    return;
  }
  const blocked = reconnectReason(account);
  if (blocked) {
    await markTargetFailed(postId, platform, blocked, { attempt });
    return;
  }

  // This target's cropped/padded/converted files.
  const renditions = post.renditions.map((link) => link.rendition);
  const failedRender = renditions.find((rendition) => rendition.status === "FAILED");
  if (failedRender) {
    console.error(`publish ${postId}: a rendition failed:`, failedRender.error);
    await markTargetFailed(
      postId,
      platform,
      "Couldn't prepare the cropped media for this platform — retry to render it again",
      { attempt },
    );
    return;
  }
  const rendering = renditions.filter((rendition) => rendition.status === "PENDING");
  if (rendering.length > 0 && token) {
    const since = waitingSince ?? Date.now();
    const limit = rendering.some((rendition) => rendition.contentType === "video/mp4")
      ? VIDEO_RENDER_WAIT_MS
      : IMAGE_RENDER_WAIT_MS;
    if (Date.now() - since > limit) {
      await markTargetFailed(
        postId,
        platform,
        "Preparing the cropped media took too long — retry to try again",
        { attempt },
      );
      return;
    }
    // Same job, checked again shortly — it stays pending, so the schedule
    // reconciler leaves it alone.
    await job.updateData({ ...job.data, waitingSince: since });
    await job.moveToDelayed(Date.now() + RENDER_POLL_MS, token);
    throw new DelayedError();
  }

  if (post.status === "SCHEDULED" && !(await markTargetProcessing(postId, attempt))) return;

  try {
    // Uploaded media gets freshly signed S3 URLs on every attempt.
    const mediaUrls = await mediaUrlsForDispatch(group.media, post.renditions, post.mediaUrls);
    await dispatchPost({ ...post, mediaUrls }, account);
  } catch (err) {
    console.error(`publish ${postId} (${platform}) failed:`, err);
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "The posting service didn't respond — try again later"
        : err instanceof Error
          ? err.message
          : "n8n dispatch failed";
    await markTargetFailed(postId, platform, message, { attempt });
    return;
  }

  await enqueueCallbackDeadline(postId, attempt, post.mediaType);
}

async function enforceDeadline({ postId, attempt }: PublishJobData): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { connectedAccount: { select: { platform: true } } },
  });
  if (!post) return;
  await markTargetFailed(
    postId,
    post.connectedAccount.platform,
    "No result came back from the platform — it may still have posted, check before retrying",
    { attempt },
  );
}

export function startPublishWorker(): Worker<PublishJobData> {
  const worker = new Worker<PublishJobData>(
    PUBLISH_QUEUE,
    async (job, token) => {
      if (job.name === "deadline") return enforceDeadline(job.data);
      return publish(job, token);
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );
  worker.on("failed", (job, err) => console.error(`publish-queue job ${job?.id} crashed:`, err));
  return worker;
}

// Postgres, not Redis, is the source of truth for schedules. This re-queues
// any due target that's still SCHEDULED but has no pending job (Redis
// flushed, job lost) — the worker then fails it as missed if it's too late.
const RECONCILE_INTERVAL_MS = 5 * 60_000;

async function reconcileDueSchedules(): Promise<void> {
  const due = await prisma.post.findMany({
    where: { status: "SCHEDULED", group: { scheduledFor: { lte: new Date() }, cancelledAt: null } },
    select: { id: true, attempt: true },
  });
  for (const post of due) {
    if (!(await hasPendingPublishJob(post.id, post.attempt))) {
      console.warn(`reconciler: re-queueing lost publish job for post ${post.id}`);
      await enqueuePublish(post.id, post.attempt);
    }
  }
}

export function startScheduleReconciler(): void {
  const run = () =>
    reconcileDueSchedules().catch((err) => console.error("schedule reconciler failed:", err));
  run();
  setInterval(run, RECONCILE_INTERVAL_MS);
}
