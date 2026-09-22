import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const VIDEO_STATUS_QUEUE = "video-status-poll";

const videoStatusQueue = new Queue(VIDEO_STATUS_QUEUE, { connection: redisConnection() });

export type VideoPollPlatform = "FACEBOOK" | "LINKEDIN";

// Facebook's POST /{page_id}/videos response id doubles as both the thing we
// poll (GET /{video_id}?fields=status) and the thing we log as
// platformPostId once ready — LinkedIn's video URN and its eventual post URN
// are two different things (finalizeUpload's video urn vs. the share/post's
// x-restli-id), so mediaId lets a caller poll one id and log a different one.
// Defaults to platformPostId so Facebook's existing call site needs no change.
export async function enqueueVideoStatusPoll(
  postId: string,
  platform: VideoPollPlatform,
  platformPostId: string,
  mediaId: string = platformPostId,
): Promise<void> {
  // 30 attempts x 30s fixed backoff = ~15min hard timeout, per websitePlan.md
  // §6's documented poller design.
  await videoStatusQueue.add(
    "poll",
    { postId, platform, platformPostId, mediaId },
    {
      attempts: 30,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
