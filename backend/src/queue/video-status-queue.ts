import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const VIDEO_STATUS_QUEUE = "video-status-poll";

const videoStatusQueue = new Queue(VIDEO_STATUS_QUEUE, { connection: redisConnection() });

// 30 attempts x 30s fixed backoff = ~15min hard timeout, per websitePlan.md
// §6's documented poller design.
export async function enqueueVideoStatusPoll(postId: string, platformPostId: string): Promise<void> {
  await videoStatusQueue.add(
    "poll",
    { postId, platformPostId },
    {
      attempts: 30,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
