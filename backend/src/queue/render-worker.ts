import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Job, Worker } from "bullmq";
import { prisma } from "../db/client";
import { logger } from "../lib/logger";
import { isVideoType } from "../lib/media-files";
import { type Rect, type RenditionSpec, renderImage, renderVideo } from "../lib/render";
import { presignDownload, putObject, readObject } from "../lib/s3";
import { redisConnection } from "./connection";
import { enqueueRender, RENDER_QUEUE, type RenderJobData } from "./render-queue";

// ffmpeg uses every core it gets; two at once keeps the API responsive.
const CONCURRENCY = 2;
// ffmpeg reads the master straight from S3 for the whole encode.
const SOURCE_URL_TTL_SECONDS = 2 * 60 * 60;

async function render(job: Job<RenderJobData>): Promise<void> {
  const rendition = await prisma.mediaRendition.findUnique({
    where: { id: job.data.renditionId },
    include: { mediaAsset: true },
  });
  // Done already (a duplicate job), or its master was cleaned up.
  if (!rendition || rendition.status !== "PENDING") return;
  const master = rendition.mediaAsset;
  if (master.status !== "READY" || !master.width || !master.height) {
    await markFailed(rendition.id, "The original file is no longer available");
    return;
  }

  const spec: RenditionSpec = {
    mode: rendition.mode,
    crop:
      rendition.cropX != null &&
      rendition.cropY != null &&
      rendition.cropW != null &&
      rendition.cropH != null
        ? { x: rendition.cropX, y: rendition.cropY, w: rendition.cropW, h: rendition.cropH }
        : (null as Rect | null),
    width: rendition.width,
    height: rendition.height,
    contentType: rendition.contentType as RenditionSpec["contentType"],
    specHash: rendition.specHash,
  };

  let sizeBytes: number;
  if (isVideoType(master.contentType)) {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    try {
      const output = join(dir, "out.mp4");
      await renderVideo(await presignDownload(master.key, SOURCE_URL_TTL_SECONDS), output, spec, {
        width: master.width,
        height: master.height,
        contentType: master.contentType,
        durationSeconds: master.durationSeconds,
      });
      sizeBytes = (await stat(output)).size;
      await putObject(rendition.key, spec.contentType, createReadStream(output));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } else {
    const output = await renderImage(await readObject(master.key), spec);
    sizeBytes = output.byteLength;
    await putObject(rendition.key, spec.contentType, output);
  }

  await prisma.mediaRendition.update({
    where: { id: rendition.id },
    data: { status: "READY", sizeBytes, completedAt: new Date(), error: null },
  });
}

async function markFailed(renditionId: string, error: string): Promise<void> {
  await prisma.mediaRendition.updateMany({
    where: { id: renditionId, status: "PENDING" },
    data: { status: "FAILED", error },
  });
}

export function startRenderWorker(): Worker<RenderJobData> {
  const worker = new Worker<RenderJobData>(RENDER_QUEUE, render, {
    connection: redisConnection(),
    concurrency: CONCURRENCY,
  });
  worker.on("failed", (job, err) => {
    if (!job) return;
    logger.error(
      { renditionId: job.data.renditionId, attempt: job.attemptsMade, err },
      "render failed",
    );
    // Out of retries: the publish worker sees FAILED and fails the targets.
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void markFailed(job.data.renditionId, err.message.slice(0, 1000));
    }
  });
  return worker;
}

// Postgres is the source of truth: re-queue renditions still PENDING whose
// job was lost (Redis flushed, crash between the post's transaction and the
// enqueue). Re-adding one that's queued or running is a no-op.
const RECONCILE_INTERVAL_MS = 5 * 60_000;

async function reconcilePendingRenders(): Promise<void> {
  const pending = await prisma.mediaRendition.findMany({
    where: { status: "PENDING" },
    select: { id: true },
  });
  for (const rendition of pending) await enqueueRender(rendition.id);
}

export function startRenderReconciler(): void {
  const run = () =>
    reconcilePendingRenders().catch((err) => logger.error({ err }, "render reconciler failed"));
  run();
  setInterval(run, RECONCILE_INTERVAL_MS);
}
