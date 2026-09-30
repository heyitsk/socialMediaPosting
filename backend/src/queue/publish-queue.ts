import type { MediaType } from "@prisma/client";
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const PUBLISH_QUEUE = "post-publish";

// Two job kinds share one queue and worker (publish-worker.ts):
// - "publish": send one target to its n8n workflow — now, or delayed until
//   the group's scheduledFor.
// - "deadline": fail the target if n8n never called back.
export interface PublishJobData {
  postId: string;
  attempt: number;
  // Set while a publish waits for its cropped/padded media to finish
  // rendering (websitePlan.md §12.5): when the wait began.
  waitingSince?: number;
}

const publishQueue = new Queue<PublishJobData>(PUBLISH_QUEUE, { connection: redisConnection() });

// Custom job ids make re-adding a no-op, so the reconciler (and a retried
// request) can't double-publish. BullMQ rejects ":" in custom ids.
export const publishJobId = (postId: string, attempt: number) => `publish-${postId}-${attempt}`;
const deadlineJobId = (postId: string, attempt: number) => `deadline-${postId}-${attempt}`;

// attempts: 1 — a failed publish is never retried automatically (websitePlan.md
// §10.1 decision 4): after a timeout we can't tell whether it went live.
export async function enqueuePublish(
  postId: string,
  attempt: number,
  runAt?: Date | null,
): Promise<void> {
  await publishQueue.add(
    "publish",
    { postId, attempt },
    {
      jobId: publishJobId(postId, attempt),
      delay: runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

// How long after a successful hand-off to n8n before a silent workflow counts
// as failed. Videos also go through the upload and the video-status poller
// (up to ~33 min for YouTube), so they get far longer.
const CALLBACK_DEADLINE_MS = 20 * 60_000;
const VIDEO_CALLBACK_DEADLINE_MS = 90 * 60_000;
const VIDEO_MEDIA_TYPES: MediaType[] = ["VIDEO", "REELS", "SHORTS"];

export function callbackDeadlineMs(mediaType: MediaType): number {
  return VIDEO_MEDIA_TYPES.includes(mediaType) ? VIDEO_CALLBACK_DEADLINE_MS : CALLBACK_DEADLINE_MS;
}

export async function enqueueCallbackDeadline(
  postId: string,
  attempt: number,
  mediaType: MediaType,
): Promise<void> {
  await publishQueue.add(
    "deadline",
    { postId, attempt },
    {
      jobId: deadlineJobId(postId, attempt),
      delay: callbackDeadlineMs(mediaType),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

// Used by cancel. Returns false if the job was already running (it then sees
// the cancellation itself and stops) or already gone.
export async function removePublishJob(postId: string, attempt: number): Promise<boolean> {
  const job = await publishQueue.getJob(publishJobId(postId, attempt));
  if (!job) return false;
  try {
    await job.remove();
    return true;
  } catch {
    return false; // locked by a worker
  }
}

export async function hasPendingPublishJob(postId: string, attempt: number): Promise<boolean> {
  const job = await publishQueue.getJob(publishJobId(postId, attempt));
  if (!job) return false;
  const state = await job.getState();
  return (
    state === "delayed" || state === "waiting" || state === "active" || state === "prioritized"
  );
}
