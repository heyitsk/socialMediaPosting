import { Worker } from "bullmq";
import { prisma } from "../db/client";
import { decrypt } from "../lib/crypto";
import { getVideoStatus as getFacebookVideoStatus } from "../lib/facebook";
import { getVideoStatus as getLinkedInVideoStatus } from "../lib/linkedin";
import { redisConnection } from "./connection";
import { VIDEO_STATUS_QUEUE, type VideoPollPlatform } from "./video-status-queue";

interface VideoStatusJobData {
  postId: string;
  platform: VideoPollPlatform;
  platformPostId: string;
  mediaId: string;
}

// Each job does one fast status-check HTTP call, then either finishes or
// throws to let BullMQ's fixed 30s backoff reschedule it — it never blocks
// the worker for the actual processing duration. Facebook and LinkedIn jobs
// share this one worker/queue; bumping concurrency lets several of those
// quick checks run in parallel instead of strictly one-at-a-time, so a burst
// of one platform's polls can't make the other platform's polls wait behind
// them (see websitePlan.md — split into per-platform queues only if this
// still isn't enough under real load).
const CONCURRENCY = 5;

export function startVideoStatusWorker(): Worker<VideoStatusJobData> {
  return new Worker<VideoStatusJobData>(
    VIDEO_STATUS_QUEUE,
    async (job) => {
      const { postId, platform, platformPostId, mediaId } = job.data;

      const post = await prisma.post.findUniqueOrThrow({
        where: { id: postId },
        include: { connectedAccount: true },
      });
      const token = decrypt(post.connectedAccount.encryptedAccessToken, post.connectedAccount.keyVersion);
      const videoStatus =
        platform === "FACEBOOK"
          ? await getFacebookVideoStatus(token, mediaId)
          : await getLinkedInVideoStatus(token, mediaId);

      if (videoStatus === "ready") {
        await prisma.postLog.create({
          data: { postId, platform, status: "SUCCESS", platformPostId },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHED" } });
        return;
      }

      if (videoStatus === "error") {
        await prisma.postLog.create({
          data: {
            postId,
            platform,
            status: "FAILED",
            errorMessage: `Video processing failed on ${platform === "FACEBOOK" ? "Facebook" : "LinkedIn"}'s end`,
          },
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
            errorMessage: `Video processing timed out after 15 minutes — check ${platform === "FACEBOOK" ? "Facebook" : "LinkedIn"} manually`,
          },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "FAILED" } });
        return;
      }

      throw new Error("Video still processing"); // triggers BullMQ's built-in retry/backoff
    },
    { connection: redisConnection(), concurrency: CONCURRENCY },
  );
}
