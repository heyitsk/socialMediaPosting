import type { ConnectedAccount } from "@prisma/client";
import { Worker } from "bullmq";
import { prisma } from "../db/client";
import { decrypt } from "../lib/crypto";
import { getVideoStatus as getFacebookVideoStatus } from "../lib/facebook";
import { getVideoStatus as getLinkedInVideoStatus } from "../lib/linkedin";
import { logger } from "../lib/logger";
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

type VideoCheckResult = { state: "ready" } | { state: "processing" } | { state: "error"; reason: string };

// One entry per platform instead of ternaries in the job body — adding a
// platform to the poller means adding a row here plus a POLL_POLICY entry.
// Each check owns its own token handling since YouTube's needs an
// ON_DEMAND refresh (a poll can outlive the 1h access token) while the
// others' stored tokens are used as-is.
const PLATFORMS: Record<
  VideoPollPlatform,
  { label: string; check: (account: ConnectedAccount, mediaId: string) => Promise<VideoCheckResult> }
> = {
  FACEBOOK: {
    label: "Facebook",
    check: async (account, mediaId) => {
      const status = await getFacebookVideoStatus(decrypt(account.encryptedAccessToken, account.keyVersion), mediaId);
      if (status === "ready") return { state: "ready" };
      if (status === "error") return { state: "error", reason: "Video processing failed on Facebook's end" };
      return { state: "processing" };
    },
  },
  LINKEDIN: {
    label: "LinkedIn",
    check: async (account, mediaId) => {
      const status = await getLinkedInVideoStatus(decrypt(account.encryptedAccessToken, account.keyVersion), mediaId);
      if (status === "ready") return { state: "ready" };
      if (status === "error") return { state: "error", reason: "Video processing failed on LinkedIn's end" };
      return { state: "processing" };
    },
  },
  YOUTUBE: {
    label: "YouTube",
    check: async (account, mediaId) => getYouTubeVideoStatus(await getFreshYouTubeAccessToken(account), mediaId),
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

export function startVideoStatusWorker(): Worker<VideoStatusJobData> {
  return new Worker<VideoStatusJobData>(
    VIDEO_STATUS_QUEUE,
    async (job) => {
      linkToProducer(job.data);
      const { postId, platform, platformPostId, mediaId } = job.data;
      const { label, check } = PLATFORMS[platform];

      const post = await prisma.post.findUniqueOrThrow({
        where: { id: postId },
        include: { connectedAccount: true },
      });
      let result: VideoCheckResult;
      try {
        result = await check(post.connectedAccount, mediaId);
      } catch (err) {
        // A status check can hit a limit too (YouTube's videos.list spends
        // the shared project quota) — pause like a failed post would, then
        // let BullMQ retry as usual. websitePlan.md §13.7.
        await pauseForLimitError({
          platform,
          platformAccountId: post.connectedAccount.platformAccountId,
          raw: err instanceof Error ? err.message : String(err),
        }).catch((pauseErr: unknown) =>
          logger.error({ postId, err: pauseErr }, "couldn't pause after video-status poll"),
        );
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
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
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
    },
    {
      connection: redisConnection(),
      concurrency: CONCURRENCY,
      settings: { backoffStrategy: pollBackoffStrategy },
      telemetry,
    },
  );
}
