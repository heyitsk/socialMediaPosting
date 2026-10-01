import type { MediaAsset, MediaRendition } from "@prisma/client";
import { prisma } from "../db/client";
import { logger } from "../lib/logger";
import { isVideoType } from "../lib/media-files";
import { type ImageShape, probeImage, probeVideo, type VideoShape } from "../lib/media-probe";
import { abortMultipartUpload, deleteObject, presignDownload, readObject } from "../lib/s3";
import { withRootSpan } from "../lib/tracing";

// websitePlan.md §11. Uploaded media is kept this long after the post's send
// time (not after upload — posts can be scheduled up to 90 days ahead), long
// enough for manual retries.
export const MEDIA_RETENTION_MS = 15 * 24 * 60 * 60_000;

// Uploads never finished, or finished but never used in a post.
const ABANDONED_AFTER_MS = 24 * 60 * 60_000;

// Meta downloads videos in the background, sometimes minutes after we hand
// over the URL, and YouTube/LinkedIn uploads can take a while — so the link
// n8n gets outlives the whole publish. Signed at send time, so scheduled
// posts and retries always get a fresh one.
const PUBLISH_URL_TTL_SECONDS = 6 * 60 * 60;

// ffprobe reads the video right away.
const PROBE_URL_TTL_SECONDS = 15 * 60;

// The uploaded file's display dimensions (and a video's duration).
export async function probeMediaAsset(
  asset: Pick<MediaAsset, "key" | "contentType">,
): Promise<ImageShape & { durationSeconds: VideoShape["durationSeconds"] | null }> {
  if (isVideoType(asset.contentType)) {
    return probeVideo(await presignDownload(asset.key, PROBE_URL_TTL_SECONDS));
  }
  return { ...(await probeImage(await readObject(asset.key))), durationSeconds: null };
}

export function mediaExpiry(scheduledFor: Date | null): Date {
  return new Date((scheduledFor ?? new Date()).getTime() + MEDIA_RETENTION_MS);
}

// The URLs a target's n8n payload carries: each file's rendition for this
// target if it has one (cropped, padded or converted — websitePlan.md §12),
// else the master. Signing is local, so every target signing its own is
// free. Groups created before S3 uploads have no media rows and keep the
// public URLs they were created with.
export async function mediaUrlsForDispatch(
  media: Pick<MediaAsset, "id" | "key" | "status">[],
  renditions: { mediaAssetId: string; rendition: Pick<MediaRendition, "key" | "status"> }[],
  legacyUrls: unknown,
): Promise<string[]> {
  if (media.length === 0) return legacyUrls as string[];
  const deleted = () =>
    new Error("This post's media was deleted (uploads are kept 15 days) — create the post again");
  if (media.some((asset) => asset.status !== "READY")) throw deleted();
  const renditionFor = new Map(renditions.map((link) => [link.mediaAssetId, link.rendition]));
  return Promise.all(
    media.map((asset) => {
      const rendition = renditionFor.get(asset.id);
      if (rendition && rendition.status !== "READY") throw deleted();
      return presignDownload(rendition?.key ?? asset.key, PUBLISH_URL_TTL_SECONDS);
    }),
  );
}

// Removes the object (and any unfinished multipart upload) and marks the row
// DELETED. S3 errors are logged and the row left alone, so the next run
// tries again.
export async function deleteMediaAsset(
  asset: Pick<MediaAsset, "id" | "key" | "multipartUploadId" | "status">,
): Promise<boolean> {
  try {
    if (asset.status === "PENDING" && asset.multipartUploadId) {
      await abortMultipartUpload(asset.key, asset.multipartUploadId).catch((err: unknown) => {
        // Already completed or aborted — the object delete below covers it.
        if (!(err instanceof Error && err.name === "NoSuchUpload")) throw err;
      });
    }
    await deleteObject(asset.key);
    // Its per-platform versions go with it (websitePlan.md §12).
    const renditions = await prisma.mediaRendition.findMany({
      where: { mediaAssetId: asset.id, status: { not: "DELETED" } },
      select: { key: true },
    });
    for (const rendition of renditions) await deleteObject(rendition.key);
  } catch (err) {
    logger.error({ mediaId: asset.id, err }, "couldn't delete media from S3");
    return false;
  }
  await prisma.$transaction([
    prisma.mediaRendition.updateMany({
      where: { mediaAssetId: asset.id },
      data: { status: "DELETED" },
    }),
    prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "DELETED", deletedAt: new Date(), multipartUploadId: null },
    }),
  ]);
  return true;
}

// Back to PENDING for another render, when a target that uses them is
// retried. Returns their ids for the render queue.
export async function resetFailedRenditions(postId: string): Promise<string[]> {
  const failed = await prisma.mediaRendition.findMany({
    where: { status: "FAILED", posts: { some: { postId } } },
    select: { id: true },
  });
  const ids = failed.map((rendition) => rendition.id);
  if (ids.length > 0) {
    await prisma.mediaRendition.updateMany({
      where: { id: { in: ids }, status: "FAILED" },
      data: { status: "PENDING", error: null },
    });
  }
  return ids;
}

const CLEAN_INTERVAL_MS = 60 * 60_000;
const CLEAN_BATCH = 200;

async function cleanMedia(): Promise<void> {
  const abandonedBefore = new Date(Date.now() - ABANDONED_AFTER_MS);
  const due = await prisma.mediaAsset.findMany({
    where: {
      OR: [
        { status: "PENDING", createdAt: { lt: abandonedBefore } },
        { status: "READY", groupId: null, createdAt: { lt: abandonedBefore } },
        // Past retention, and no target still waiting to go out with it.
        {
          status: "READY",
          expiresAt: { lt: new Date() },
          group: { posts: { none: { status: { in: ["SCHEDULED", "PROCESSING"] } } } },
        },
      ],
    },
    select: { id: true, key: true, multipartUploadId: true, status: true },
    take: CLEAN_BATCH,
  });
  let deleted = 0;
  for (const asset of due) {
    if (await deleteMediaAsset(asset)) deleted++;
  }
  if (deleted > 0) logger.info({ deleted }, "media cleaner: deleted objects");
}

export function startMediaCleaner(): void {
  const run = () =>
    withRootSpan("clean media", cleanMedia).catch((err) =>
      logger.error({ err }, "media cleaner failed"),
    );
  run();
  setInterval(run, CLEAN_INTERVAL_MS);
}
