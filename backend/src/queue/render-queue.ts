import { Queue } from "bullmq";
import { redisConnection } from "./connection";
import { observeQueueDepth, telemetry } from "./telemetry";

// Renders per-platform versions of uploaded media (websitePlan.md §12.5).
// Its own queue and worker because ffmpeg saturates CPU — it must not hold
// up publishing, and can later move to its own machines.
export const RENDER_QUEUE = "media-render";

export interface RenderJobData {
  renditionId: string;
}

const renderQueue = new Queue<RenderJobData>(RENDER_QUEUE, {
  connection: redisConnection(),
  telemetry,
});
observeQueueDepth(renderQueue);

// One job per rendition, so the targets sharing it and the reconciler can
// all enqueue it without rendering twice. A render is safe to redo (it
// rewrites the same key), so one automatic retry covers a flaky S3/network.
export async function enqueueRender(renditionId: string): Promise<void> {
  await renderQueue.add(
    "render",
    { renditionId },
    {
      jobId: `render-${renditionId}`,
      attempts: 2,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
