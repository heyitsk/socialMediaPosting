import type { ConnectedAccount } from "@prisma/client";
import { type Job, Worker } from "bullmq";
import { prisma } from "../db/client";
import { decrypt } from "../lib/crypto";
import { getVideoStatus as getFacebookVideoStatus } from "../lib/facebook";
import { getVideoStatus as getLinkedInVideoStatus } from "../lib/linkedin";
import { logger } from "../lib/logger";
import { isAccountAccessError } from "../lib/platform-error";
import { getVideoStatus as getYouTubeVideoStatus } from "../lib/youtube";
import { pauseForLimitError } from "../service/limit-pauses";
import { markTargetFailed, markTargetPublished } from "../service/post-groups";
import { getFreshYouTubeAccessToken } from "../service/youtube-token";
import { redisConnection } from "./connection";
import { linkToProducer, type TraceLinkData, telemetry } from "./telemetry";
import {
  pollBackoffStrategy,
  pollTimeoutMs,
  VIDEO_STATUS_QUEUE,
  type VideoPollPlatform,
} from "./video-status-queue";

interface VideoStatusJobData extends TraceLinkData {
  postId: string;
  platform: VideoPollPlatform;
  platformPostId: string;
  mediaId: string;
}

type VideoCheckResult =
  | { state: "ready" }
  | { state: "processing" }
  | { state: "error"; reason: string };

// One entry per platform instead of ternaries in the job body — adding a
// platform to the poller means adding a row here plus a POLL_POLICY entry.
// Each check owns its own token handling since YouTube's needs an
// ON_DEMAND refresh (a poll can outlive the 1h access token) while the
// others' stored tokens are used as-is.
const PLATFORMS: Record<
  VideoPollPlatform,
  {
    label: string;
    check: (account: ConnectedAccount, mediaId: string) => Promise<VideoCheckResult>;
  }
> = {
  FACEBOOK: {
    label: "Facebook",
    check: async (account, mediaId) => {
      const status = await getFacebookVideoStatus(
        decrypt(account.encryptedAccessToken, account.keyVersion),
        mediaId,
      );
      if (status === "ready") return { state: "ready" };
      if (status === "error")
        return { state: "error", reason: "Video processing failed on Facebook's end" };
      return { state: "processing" };
    },
  },
  LINKEDIN: {
    label: "LinkedIn",
    check: async (account, mediaId) => {
      const status = await getLinkedInVideoStatus(
        decrypt(account.encryptedAccessToken, account.keyVersion),
        mediaId,
      );
      if (status === "ready") return { state: "ready" };
      if (status === "error")
        return { state: "error", reason: "Video processing failed on LinkedIn's end" };
      return { state: "processing" };
    },
  },
  YOUTUBE: {
    label: "YouTube",
    check: async (account, mediaId) =>
      getYouTubeVideoStatus(await getFreshYouTubeAccessToken(account), mediaId),
  },
};

// Each job does one fast status-check HTTP call, then either finishes or
// throws to let BullMQ's per-platform backoff (POLL_POLICY) reschedule it — it never blocks the
// worker for the actual processing duration. All platforms share this one
// worker/queue; bumping concurrency lets several of those quick checks run
// in parallel instead of strictly one-at-a-time, so a burst of one
// platform's polls can't make another platform's polls wait behind them
// (see websitePlan.md — split into per-platform queues only once one needs
// its own rate limiter or independent scaling).
const CONCURRENCY = 5;

export async function pollVideoStatus(job: Job<VideoStatusJobData>): Promise<void> {
  linkToProducer(job.data);
  const { postId, platform, platformPostId, mediaId } = job.data;
  const { label, check } = PLATFORMS[platform];
  const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

  const post = await prisma.post.findUniqueOrThrow({
    where: { id: postId },
    include: { connectedAccount: true },
  });
  // Disconnecting wipes the tokens (service/connected-accounts.ts), so there's
  // nothing to poll with — and no point retrying.
  if (post.connectedAccount.disconnectedAt) {
    await markTargetFailed(
      postId,
      platform,
      `The account was disconnected before ${label} finished processing the video — it may still be live there`,
      { platformPostId },
    );
    return;
  }
  let result: VideoCheckResult;
  try {
    result = await check(post.connectedAccount, mediaId);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // A status check can hit a limit too (YouTube's videos.list spends
    // the shared project quota) — pause like a failed post would, then
    // let BullMQ retry as usual. websitePlan.md §13.7.
    await pauseForLimitError({
      platform,
      platformAccountId: post.connectedAccount.platformAccountId,
      raw,
    }).catch((pauseErr: unknown) =>
      logger.error({ postId, err: pauseErr }, "couldn't pause after video-status poll"),
    );
    // A revoked token fails every later check the same way, so stop now;
    // anything else gets the rest of the attempts. Either way the target
    // fails here with the real reason — left to throw, the job would just
    // disappear (removeOnFail) and the post wait for the callback deadline.
    if (isLastAttempt || isAccountAccessError(raw)) {
      await markTargetFailed(
        postId,
        platform,
        `Couldn't confirm ${label} finished processing the video — it may still be live there. ${raw}`,
        { platformPostId },
      );
      return;
    }
    throw err;
  }

  if (result.state === "ready") {
    await markTargetPublished(postId, platform, platformPostId);
    return;
  }

  if (result.state === "error") {
    await markTargetFailed(postId, platform, result.reason, { platformPostId });
    return;
  }

  // still "processing"
  if (isLastAttempt) {
    await markTargetFailed(
      postId,
      platform,
      `Video processing timed out after ${Math.round(pollTimeoutMs(platform) / 60_000)} minutes — check ${label} manually`,
      { platformPostId },
    );
    return;
  }

  throw new Error("Video still processing"); // triggers BullMQ's built-in retry/backoff
}

// Backstop for anything pollVideoStatus doesn't catch itself (a database
// error, say). BullMQ emits "failed" after every attempt, retries included,
// with attemptsMade already counting this one; only the last one is final.
// markTargetFailed is a no-op if the target already left PROCESSING.
export async function onVideoPollFailed(
  job: Job<VideoStatusJobData> | undefined,
  err: Error,
): Promise<void> {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const { postId, platform, platformPostId } = job.data;
  logger.error({ jobId: job.id, postId, err }, "video-status poll crashed");
  await markTargetFailed(
    postId,
    platform,
    `Couldn't confirm ${PLATFORMS[platform].label} finished processing the video — it may still be live there. ${err.message}`,
    { platformPostId },
  ).catch((markErr: unknown) =>
    logger.error({ postId, err: markErr }, "couldn't fail target after video-status poll crashed"),
  );
}

export function startVideoStatusWorker(): Worker<VideoStatusJobData> {
  const worker = new Worker<VideoStatusJobData>(VIDEO_STATUS_QUEUE, pollVideoStatus, {
    connection: redisConnection(),
    concurrency: CONCURRENCY,
    settings: { backoffStrategy: pollBackoffStrategy },
    telemetry,
  });
  worker.on("failed", (job, err) => void onVideoPollFailed(job, err));
  return worker;
}
