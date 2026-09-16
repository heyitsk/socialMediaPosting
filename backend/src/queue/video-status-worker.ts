import { Worker } from "bullmq";
import { prisma } from "../db/client";
import { decrypt } from "../lib/crypto";
import { getVideoStatus } from "../lib/facebook";
import { redisConnection } from "./connection";
import { VIDEO_STATUS_QUEUE } from "./video-status-queue";

interface VideoStatusJobData {
  postId: string;
  platformPostId: string;
}

export function startVideoStatusWorker(): Worker<VideoStatusJobData> {
  return new Worker<VideoStatusJobData>(
    VIDEO_STATUS_QUEUE,
    async (job) => {
      const { postId, platformPostId } = job.data;

      const post = await prisma.post.findUniqueOrThrow({
        where: { id: postId },
        include: { connectedAccount: true },
      });
      const token = decrypt(post.connectedAccount.encryptedAccessToken, post.connectedAccount.keyVersion);
      const videoStatus = await getVideoStatus(token, platformPostId);

      if (videoStatus === "ready") {
        await prisma.postLog.create({
          data: { postId, platform: "FACEBOOK", status: "SUCCESS", platformPostId },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHED" } });
        return;
      }

      if (videoStatus === "error") {
        await prisma.postLog.create({
          data: {
            postId,
            platform: "FACEBOOK",
            status: "FAILED",
            errorMessage: "Video processing failed on Facebook's end",
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
            platform: "FACEBOOK",
            status: "FAILED",
            errorMessage: "Video processing timed out after 15 minutes — check Facebook manually",
          },
        });
        await prisma.post.update({ where: { id: postId }, data: { status: "FAILED" } });
        return;
      }

      throw new Error("Video still processing"); // triggers BullMQ's built-in retry/backoff
    },
    { connection: redisConnection() },
  );
}
