import { createHash } from "node:crypto";
import type { RenditionMode } from "@prisma/client";
import sharp from "sharp";
import { isVideoType } from "./media-files";

// Per-platform versions of an uploaded file (websitePlan.md §12): a crop, a
// blurred-background pad, or a plain JPEG conversion for Instagram. The
// composer sends only what to do (mode, shape, region); this file decides
// the output size and does the pixels — sharp for images, ffmpeg for video.

export interface Rect {
  // Fractions (0-1) of the master as displayed (EXIF/rotation applied).
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Fit {
  mode: "CROP" | "PAD";
  // Output width / height.
  ratio: number;
  // CROP only: the region kept.
  rect?: Rect;
}

export interface RenditionSpec {
  mode: RenditionMode;
  crop: Rect | null;
  width: number;
  height: number;
  contentType: "image/jpeg" | "video/mp4";
  specHash: string;
}

interface Master {
  width: number;
  height: number;
  contentType: string;
}

// Output never exceeds these (1080 on the short side, like the platforms'
// own recommendations), and never upscales the source.
const MAX_SHORT_EDGE = 1080;
const MAX_LONG_EDGE = 1920;

// libx264 with yuv420p needs even dimensions; harmless for images.
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

function boundedSize(ratio: number): { width: number; height: number } {
  if (ratio <= 1) {
    const height = Math.min(MAX_LONG_EDGE, MAX_SHORT_EDGE / ratio);
    return { width: height * ratio, height };
  }
  const width = Math.min(MAX_LONG_EDGE, MAX_SHORT_EDGE * ratio);
  return { width, height: width / ratio };
}

// Four decimals is well under a pixel at 1920 px, and keeps two targets'
// "same" crop hashing the same.
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

// `fit` null means a CONVERT (Instagram, non-JPEG image, no crop).
export function renditionSpec(master: Master, fit: Fit | null): RenditionSpec {
  const video = isVideoType(master.contentType);
  const contentType = video ? "video/mp4" : "image/jpeg";
  let mode: RenditionMode;
  let crop: Rect | null = null;
  let width: number;
  let height: number;

  if (!fit) {
    mode = "CONVERT";
    width = master.width;
    height = master.height;
  } else if (fit.mode === "CROP") {
    mode = "CROP";
    const rect = fit.rect ?? { x: 0, y: 0, w: 1, h: 1 };
    crop = { x: round4(rect.x), y: round4(rect.y), w: round4(rect.w), h: round4(rect.h) };
    const bound = boundedSize(fit.ratio);
    const scale = Math.min(1, (crop.w * master.width) / bound.width);
    width = even(bound.width * scale);
    height = even(bound.height * scale);
  } else {
    mode = "PAD";
    const bound = boundedSize(fit.ratio);
    // Shrink the frame rather than blow the master up to fill it.
    const containScale = Math.min(bound.width / master.width, bound.height / master.height);
    const scale = containScale > 1 ? 1 / containScale : 1;
    width = even(bound.width * scale);
    height = even(bound.height * scale);
  }

  const specHash = createHash("sha256")
    .update(JSON.stringify({ mode, crop, width, height, contentType }))
    .digest("hex")
    .slice(0, 16);
  return { mode, crop, width, height, contentType, specHash };
}

export function renditionKey(key: string, specHash: string, contentType: string): string {
  // `<workspaceId>/<assetId>.<ext>` → `<workspaceId>/<assetId>/r/<hash>.<ext>`
  const base = key.replace(/\.[^./]+$/, "");
  return `${base}/r/${specHash}.${contentType === "video/mp4" ? "mp4" : "jpg"}`;
}

// The crop region in pixels of a width x height frame, snapped inside it.
function cropPixels(crop: Rect, width: number, height: number, snap: (v: number) => number) {
  const w = Math.min(width, Math.max(1, snap(crop.w * width)));
  const h = Math.min(height, Math.max(1, snap(crop.h * height)));
  const left = Math.min(width - w, Math.max(0, snap(crop.x * width)));
  const top = Math.min(height - h, Math.max(0, snap(crop.y * height)));
  return { left, top, width: w, height: h };
}

const JPEG = { quality: 90, mozjpeg: true } as const;

// Always JPEG out. Transparent PNGs get a white background (JPEG has no
// alpha, and black is what they'd otherwise turn into). sharp drops EXIF and
// converts to sRGB on output by default.
export async function renderImage(bytes: Uint8Array, spec: RenditionSpec): Promise<Buffer> {
  // .rotate() with no angle applies the EXIF orientation first, so the crop
  // coordinates match what the composer showed.
  const oriented = () => sharp(bytes).rotate();
  if (spec.mode === "CONVERT") {
    return oriented().flatten({ background: "#fff" }).jpeg(JPEG).toBuffer();
  }
  if (spec.mode === "CROP") {
    const { data, info } = await oriented().toBuffer({ resolveWithObject: true });
    const region = cropPixels(
      spec.crop ?? { x: 0, y: 0, w: 1, h: 1 },
      info.width,
      info.height,
      Math.round,
    );
    return sharp(data)
      .extract(region)
      .resize(spec.width, spec.height, { fit: "fill" })
      .flatten({ background: "#fff" })
      .jpeg(JPEG)
      .toBuffer();
  }
  const background = await oriented()
    .resize(spec.width, spec.height, { fit: "cover" })
    .blur(40)
    .modulate({ brightness: 0.75 })
    .toBuffer();
  const foreground = await oriented().resize(spec.width, spec.height, { fit: "inside" }).toBuffer();
  return sharp(background)
    .composite([{ input: foreground, gravity: "center" }])
    .flatten({ background: "#fff" })
    .jpeg(JPEG)
    .toBuffer();
}

// Re-encode settings: widely accepted by every platform (H.264 High, yuv420p,
// AAC), quality close to the source, fast enough for a small worker.
// +faststart moves the index to the front so platforms can start reading
// before the whole file arrives.
const VIDEO_OUTPUT = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "160k",
  "-movflags",
  "+faststart",
];

// ffmpeg filters for a CROP or PAD. ffmpeg auto-rotates its input, so the
// filters see the video as displayed — same frame the crop was drawn on.
function videoFilters(spec: RenditionSpec, master: Master): string[] {
  const { width, height } = spec;
  if (spec.mode === "CROP") {
    const region = cropPixels(
      spec.crop ?? { x: 0, y: 0, w: 1, h: 1 },
      master.width,
      master.height,
      even,
    );
    return [
      "-vf",
      `crop=${region.width}:${region.height}:${region.left}:${region.top},scale=${width}:${height},setsar=1`,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
    ];
  }
  // PAD: a blurred, darkened copy filling the frame, the whole video on top.
  return [
    "-filter_complex",
    `[0:v]split=2[a][b];` +
      `[a]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:2,eq=brightness=-0.08[bg];` +
      `[b]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`,
    "-map",
    "[v]",
    "-map",
    "0:a:0?",
  ];
}

// Renders a video from `inputUrl` (a presigned GET of the master) to
// `outputPath`. Throws with ffmpeg's last error lines on failure or timeout.
export async function renderVideo(
  inputUrl: string,
  outputPath: string,
  spec: RenditionSpec,
  master: Master & { durationSeconds: number | null },
): Promise<void> {
  if (spec.mode === "CONVERT")
    throw new Error("Videos are never converted, only cropped or padded");
  // veryfast 1080p runs at a few times real time on one core; allow plenty.
  const timeoutMs = (5 * 60 + 4 * (master.durationSeconds ?? 600)) * 1000;
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-i",
      inputUrl,
      ...videoFilters(spec, master),
      ...VIDEO_OUTPUT,
      outputPath,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (timedOut) throw new Error("Rendering the video took too long");
  if (exitCode !== 0) {
    const detail = stderr.trim().split("\n").slice(-3).join(" ");
    throw new Error(`ffmpeg failed (${exitCode}): ${detail || "no output"}`);
  }
}
