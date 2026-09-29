import type { MediaAsset } from "@prisma/client";
import { prisma } from "../db/client";
import { abortMultipartUpload, deleteObject, presignDownload } from "../lib/s3";

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

export function mediaExpiry(scheduledFor: Date | null): Date {
  return new Date((scheduledFor ?? new Date()).getTime() + MEDIA_RETENTION_MS);
}

// The URLs a target's n8n payload carries. Groups created before S3 uploads
// have no media rows and keep the public URLs they were created with.
export async function mediaUrlsForDispatch(
  media: Pick<MediaAsset, "key" | "status">[],
  legacyUrls: unknown,
): Promise<string[]> {
  if (media.length === 0) return legacyUrls as string[];
  if (media.some((asset) => asset.status !== "READY")) {
    throw new Error(
      "This post's media was deleted (uploads are kept 15 days) — create the post again",
    );
  }
  return Promise.all(media.map((asset) => presignDownload(asset.key, PUBLISH_URL_TTL_SECONDS)));
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
  } catch (err) {
    console.error(`couldn't delete media ${asset.id} from S3:`, err);
    return false;
  }
  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { status: "DELETED", deletedAt: new Date(), multipartUploadId: null },
  });
  return true;
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
  if (deleted > 0) console.log(`media cleaner: deleted ${deleted} object(s)`);
}

export function startMediaCleaner(): void {
  const run = () => cleanMedia().catch((err) => console.error("media cleaner failed:", err));
  run();
  setInterval(run, CLEAN_INTERVAL_MS);
}
