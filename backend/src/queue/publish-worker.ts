import { DelayedError, type Job, Worker } from "bullmq";
import { prisma } from "../db/client";
import { isPostablePlatform, reconnectReason } from "../lib/capabilities";
import { pausedFailureMessage } from "../lib/posting-limits";
import { mediaForDispatch } from "../service/media";
import { dispatchPost } from "../service/n8n";
import {
  markTargetCancelled,
  markTargetFailed,
  markTargetProcessing,
} from "../service/post-groups";
import { activeCooldown, bookedSlotAt, releaseSlot } from "../service/posting-limits";
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

// Exported for tests; the worker below is the real caller.
export async function publish(job: Job<PublishJobData>, token?: string): Promise<void> {
  const { postId, attempt, waitingSince } = job.data;
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      connectedAccount: true,
      group: {
        include: {
          workspace: { select: { deletedAt: true } },
          media: {
            orderBy: { position: "asc" },
            select: { id: true, key: true, status: true, sizeBytes: true },
          },
        },
      },
      renditions: {
        select: {
          mediaAssetId: true,
          rendition: {
            select: { key: true, status: true, contentType: true, error: true, sizeBytes: true },
          },
        },
      },
    },
  });
  // Superseded by a retry, or already handled (cancelled, duplicate job).
  if (!post || post.attempt !== attempt) return;
  if (post.status !== "SCHEDULED" && post.status !== "PROCESSING") return;

  const { group, connectedAccount: account } = post;
  const platform = account.platform;

  // Failed before reaching n8n: the platform never saw it, so its slot stops
  // counting against the account's posting limit (websitePlan.md §13.6).
  const failUnsent = async (message: string) => {
    if (await markTargetFailed(postId, platform, message, { attempt })) {
      await releaseSlot(prisma, postId, attempt);
    }
  };

  // Cancelling only stops targets not yet sent — a manual retry of one that
  // failed before the cancel still goes out.
  if (post.status === "SCHEDULED" && (group.cancelledAt || group.workspace.deletedAt)) {
    if (await markTargetCancelled(postId)) await releaseSlot(prisma, postId, attempt);
    return;
  }

  // When the posting limiter booked it to go out: the scheduled time, or
  // later if the account needed a gap. Null for posts from before the limiter.
  const slotAt = await bookedSlotAt(prisma, postId, attempt);

  // Not while waiting for renders — that wait has its own limit below.
  const due = group.scheduledFor ? (slotAt ?? group.scheduledFor) : null;
  if (
    attempt === 1 &&
    waitingSince === undefined &&
    due &&
    Date.now() - due.getTime() > MAX_SCHEDULE_LATENESS_MS
  ) {
    await failUnsent(
      "Missed its scheduled time (the server was unavailable) — retry to post it now",
    );
    return;
  }

  // Scheduled posts are re-checked at send time: the account may have been
  // disconnected, or its token may have lapsed, since the post was created.
  if (account.disconnectedAt) {
    await failUnsent("The account was disconnected — reconnect it and retry");
    return;
  }
  const blocked = reconnectReason(account);
  if (blocked) {
    await failUnsent(blocked);
    return;
  }

  // Paused after a spam block or a platform limit: fail rather than wait,
  // so the user decides what to do (websitePlan.md §13.9 decision 4).
  if (isPostablePlatform(platform)) {
    const cooldown = await activeCooldown(prisma, platform, account.platformAccountId);
    if (cooldown) {
      await failUnsent(pausedFailureMessage(cooldown, Date.now()));
      return;
    }
  }

  // The job is normally queued to run at its slot. One that runs early (put
  // back by the schedule reconciler) waits for it.
  if (slotAt && slotAt.getTime() > Date.now() && token) {
    await job.moveToDelayed(slotAt.getTime(), token);
    throw new DelayedError();
  }

  // This target's cropped/padded/converted files.
  const renditions = post.renditions.map((link) => link.rendition);
  const failedRender = renditions.find((rendition) => rendition.status === "FAILED");
  if (failedRender) {
    console.error(`publish ${postId}: a rendition failed:`, failedRender.error);
    await failUnsent(
      "Couldn't prepare the cropped media for this platform — retry to render it again",
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
      await failUnsent("Preparing the cropped media took too long — retry to try again");
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
    const { mediaUrls, mediaSizes } = await mediaForDispatch(
      group.media,
      post.renditions,
      post.mediaUrls,
    );
    await dispatchPost({ ...post, mediaUrls }, account, mediaSizes);
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
  const now = new Date();
  // Scheduled groups, and "post now" targets the posting limiter pushed
  // back (SCHEDULED with a slot, no scheduledFor).
  const due = await prisma.post.findMany({
    where: {
      status: "SCHEDULED",
      group: { cancelledAt: null },
      OR: [
        { group: { scheduledFor: { lte: now } } },
        { dispatchSlots: { some: { releasedAt: null, slotAt: { lte: now } } } },
      ],
    },
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
