import type { ConnectedAccount } from "@prisma/client";
import { Worker } from "bullmq";
import { prisma } from "../db/client";
import { decrypt } from "../lib/crypto";
import { getVideoStatus as getFacebookVideoStatus } from "../lib/facebook";
import { getVideoStatus as getLinkedInVideoStatus } from "../lib/linkedin";
import { getVideoStatus as getYouTubeVideoStatus } from "../lib/youtube";
import { getFreshYouTubeAccessToken } from "../service/youtube-token";
import { redisConnection } from "./connection";
import {
  pollBackoffStrategy,
  pollTimeoutMs,
  VIDEO_STATUS_QUEUE,
  type VideoPollPlatform,
} from "./video-status-queue";

interface VideoStatusJobData {
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
      const { postId, platform, platformPostId, mediaId } = job.data;
      const { label, check } = PLATFORMS[platform];

      const post = await prisma.post.findUniqueOrThrow({
        where: { id: postId },
        include: { connectedAccount: true },
      });
      const result = await check(post.connectedAccount, mediaId);

      if (result.state === "ready") {
        await prisma.postLog.create({
          data: { postId, platform, status: "SUCCESS", platformPostId },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHED" } });
        return;
      }

      if (result.state === "error") {
        await prisma.postLog.create({
          data: { postId, platform, status: "FAILED", platformPostId, errorMessage: result.reason },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "FAILED" } });
        return;
      }

      // still "processing"
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLastAttempt) {
        await prisma.postLog.create({
          data: {
            postId,
            platform,
            status: "FAILED",
            platformPostId,
            errorMessage: `Video processing timed out after ${Math.round(pollTimeoutMs(platform) / 60_000)} minutes — check ${label} manually`,
          },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "FAILED" } });
        return;
      }

      throw new Error("Video still processing"); // triggers BullMQ's built-in retry/backoff
    },
    {
      connection: redisConnection(),
      concurrency: CONCURRENCY,
      settings: { backoffStrategy: pollBackoffStrategy },
    },
  );
}
