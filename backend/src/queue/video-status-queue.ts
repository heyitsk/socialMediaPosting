import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const VIDEO_STATUS_QUEUE = "video-status-poll";

// Custom BullMQ backoff type — resolved by pollBackoffStrategy below, which
// video-status-worker.ts registers as its settings.backoffStrategy.
const POLL_BACKOFF_TYPE = "video-status-poll";

const videoStatusQueue = new Queue(VIDEO_STATUS_QUEUE, { connection: redisConnection() });

export type VideoPollPlatform = "FACEBOOK" | "LINKEDIN" | "YOUTUBE";

const YOUTUBE_BASE_DELAY_MS = 15_000;
const YOUTUBE_MAX_DELAY_MS = 5 * 60_000;

// attempts = total status checks; delayMs(n) = wait before the nth retry
// (n starts at 1). Facebook/LinkedIn keep websitePlan.md §6's documented
// fixed 30s x 30 (~15min). YouTube backs off exponentially, capped at 5min —
// most videos finish in the first few minutes, so early checks are dense and
// later ones sparse: 15s, 30s, 1m, 2m, 4m, then 5m x5 ≈ 33min over 11 calls
// instead of 60 fixed ones (each costs a YouTube quota unit).
export const POLL_POLICY: Record<VideoPollPlatform, { attempts: number; delayMs: (retry: number) => number }> = {
  FACEBOOK: { attempts: 30, delayMs: () => 30_000 },
  LINKEDIN: { attempts: 30, delayMs: () => 30_000 },
  YOUTUBE: {
    attempts: 11,
    delayMs: (retry) => Math.min(YOUTUBE_BASE_DELAY_MS * 2 ** (retry - 1), YOUTUBE_MAX_DELAY_MS),
  },
};

// Hard timeout for the worker's "timed out after N minutes" log message.
export function pollTimeoutMs(platform: VideoPollPlatform): number {
  const { attempts, delayMs } = POLL_POLICY[platform];
  let total = 0;
  for (let retry = 1; retry < attempts; retry++) total += delayMs(retry);
  return total;
}

export function pollBackoffStrategy(attemptsMade: number, _type?: string, _err?: Error, job?: { data: { platform: VideoPollPlatform } }): number {
  // Every job on this queue is enqueued below with a platform — fall back to
  // 30s only to satisfy BullMQ's optional job param.
  return job ? POLL_POLICY[job.data.platform].delayMs(attemptsMade) : 30_000;
}

// Facebook's POST /{page_id}/videos response id doubles as both the thing we
// poll (GET /{video_id}?fields=status) and the thing we log as
// platformPostId once ready — LinkedIn's video URN and its eventual post URN
// are two different things (finalizeUpload's video urn vs. the share/post's
// x-restli-id), so mediaId lets a caller poll one id and log a different one.
// Defaults to platformPostId so Facebook's and YouTube's call sites (where
// the two ids are the same) needn't pass it.
export async function enqueueVideoStatusPoll(
  postId: string,
  platform: VideoPollPlatform,
  platformPostId: string,
  mediaId: string = platformPostId,
): Promise<void> {
  await videoStatusQueue.add(
    "poll",
    { postId, platform, platformPostId, mediaId },
    {
      attempts: POLL_POLICY[platform].attempts,
      backoff: { type: POLL_BACKOFF_TYPE },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
