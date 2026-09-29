import { api } from "@/lib/api";
import type { components } from "@/lib/api-schema";

// Uploads go straight from the browser to S3 with presigned URLs the backend
// hands out — see backend/src/routes/media.ts and websitePlan.md §11.

export type MediaAsset = components["schemas"]["MediaAsset"];

// Mirrors backend/src/lib/media-files.ts, which has the final say.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
export const VIDEO_ACCEPT = VIDEO_TYPES.join(",");

type UploadContentType = (typeof IMAGE_TYPES)[number] | (typeof VIDEO_TYPES)[number];

// Some systems leave File.type empty for .mov and friends.
const TYPE_BY_EXTENSION: Record<string, UploadContentType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? "";
}

export function isVideoFile(file: File): boolean {
  return contentTypeOf(file).startsWith("video/");
}

// Why this file can't be used, or null if it can.
export function fileProblem(file: File, wantVideo: boolean): string | null {
  const type = contentTypeOf(file);
  if (type === "image/heic" || type === "image/heif" || /\.hei[cf]$/i.test(file.name))
    return `${file.name} is HEIC, which no platform accepts — export it as JPEG`;
  const allowed: readonly string[] = wantVideo ? VIDEO_TYPES : IMAGE_TYPES;
  if (!allowed.includes(type))
    return wantVideo
      ? `${file.name} isn't an MP4 or MOV video`
      : `${file.name} isn't a JPEG, PNG or WebP image`;
  const max = wantVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > max)
    return `${file.name} is ${formatBytes(file.size)} — ${wantVideo ? "videos" : "images"} can be at most ${formatBytes(max)}`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

class StorageError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 0
        ? "Lost connection while uploading"
        : `The storage service rejected the upload (HTTP ${status})`,
    );
    this.status = status;
  }
}

// XHR rather than fetch: fetch can't report upload progress.
function send(
  method: "POST" | "PUT",
  url: string,
  body: Blob | FormData,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve(xhr) : reject(new StorageError(xhr.status));
    xhr.onerror = () => reject(new StorageError(0));
    xhr.onabort = () => reject(signal.reason);
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

// Dropped connections and S3 hiccups (5xx, 429) are worth retrying; a 403 or
// 400 (expired URL, size mismatch) won't get better.
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

async function withRetries<T>(signal: AbortSignal, attempt: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (err) {
      const retryable =
        err instanceof StorageError &&
        (err.status === 0 || err.status === 429 || err.status >= 500);
      const delay = RETRY_DELAYS_MS[retry];
      if (!retryable || delay === undefined || signal.aborted) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Parallel part uploads; more than a handful just share the same bandwidth.
const PART_CONCURRENCY = 4;

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "error" in error && typeof error.error === "string")
    return error.error;
  return fallback;
}

// Resolves with the READY asset. onProgress gets 0-1.
export async function uploadMedia(
  workspaceId: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  onCreated: (assetId: string) => void,
): Promise<MediaAsset> {
  const params = { path: { workspaceId } };
  const { data: started, error } = await api.POST("/api/workspaces/{workspaceId}/media", {
    params,
    body: {
      filename: file.name,
      contentType: contentTypeOf(file) as UploadContentType,
      sizeBytes: file.size,
    },
    signal,
  });
  if (error || !started) throw new Error(errorMessage(error, "Couldn't start the upload"));
  const { asset, upload } = started;
  onCreated(asset.id);

  let parts: { partNumber: number; etag: string }[] | undefined;
  if (upload.method === "POST") {
    await withRetries(signal, () => {
      const form = new FormData();
      for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
      // S3 requires the file to be the last field.
      form.append("file", file);
      return send("POST", upload.url, form, (loaded) => onProgress(loaded / file.size), signal);
    });
  } else {
    const loaded = new Array<number>(upload.parts.length).fill(0);
    const report = () => onProgress(loaded.reduce((sum, bytes) => sum + bytes, 0) / file.size);
    const etags: { partNumber: number; etag: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < upload.parts.length) {
        const index = next++;
        const part = upload.parts[index];
        if (!part) return;
        const start = index * upload.partSize;
        const slice = file.slice(start, Math.min(start + upload.partSize, file.size));
        const xhr = await withRetries(signal, () => {
          loaded[index] = 0;
          return send(
            "PUT",
            part.url,
            slice,
            (bytes) => {
              loaded[index] = bytes;
              report();
            },
            signal,
          );
        });
        const etag = xhr.getResponseHeader("ETag");
        // Only readable if the bucket's CORS config exposes it.
        if (!etag) throw new Error("Upload finished but S3's ETag header isn't readable (CORS)");
        etags.push({ partNumber: part.partNumber, etag });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, upload.parts.length) }, worker),
    );
    parts = etags;
  }

  const { data: ready, error: completeError } = await api.POST(
    "/api/workspaces/{workspaceId}/media/{assetId}/complete",
    { params: { path: { workspaceId, assetId: asset.id } }, body: { parts }, signal },
  );
  if (completeError || !ready)
    throw new Error(errorMessage(completeError, "Couldn't finish the upload"));
  return ready;
}

// Best effort — anything left behind is removed by the backend's cleaner.
export async function discardMedia(workspaceId: string, assetId: string): Promise<void> {
  await api
    .DELETE("/api/workspaces/{workspaceId}/media/{assetId}", {
      params: { path: { workspaceId, assetId } },
    })
    .catch(() => undefined);
}
