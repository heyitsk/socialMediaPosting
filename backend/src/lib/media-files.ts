// What the composer may upload, and how we check it really is that.
// websitePlan.md §11. frontend/src/lib/media-upload.ts mirrors the type list
// and size limits for the file picker — this file is the authority.

export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export const VIDEO_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
} as const;

export type ImageContentType = keyof typeof IMAGE_TYPES;
export type VideoContentType = keyof typeof VIDEO_TYPES;
export type MediaContentType = ImageContentType | VideoContentType;

export const MEDIA_CONTENT_TYPES = [...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)] as [
  MediaContentType,
  ...MediaContentType[],
];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

export function isVideoType(contentType: string): contentType is VideoContentType {
  return contentType in VIDEO_TYPES;
}

export function maxBytesFor(contentType: MediaContentType): number {
  return isVideoType(contentType) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

// Workspace id first (ownership, and a high-entropy prefix so S3 spreads the
// keys across index partitions), then our own id. The user's filename never
// goes in the key. The extension is only a hint for tools that look at URLs.
export function mediaKey(workspaceId: string, assetId: string, contentType: MediaContentType) {
  const ext = isVideoType(contentType) ? VIDEO_TYPES[contentType] : IMAGE_TYPES[contentType];
  return `${workspaceId}/${assetId}.${ext}`;
}

// Videos upload in parts. S3 allows at most 10,000 parts per upload, so the
// part size grows past the 16 MiB floor only for files over ~160 GB — at
// today's 1 GB cap it's always 16 MiB (at most 64 parts). A failed part is
// retried alone, so smaller parts mean cheaper retries.
const MIN_PART_BYTES = 16 * 1024 * 1024;
const MAX_PARTS = 10_000;

export function partSizeFor(sizeBytes: number): number {
  return Math.max(MIN_PART_BYTES, Math.ceil(sizeBytes / MAX_PARTS));
}

// How many leading bytes sniffContentType needs.
export const SNIFF_BYTES = 16;

// Brands in an ISO-BMFF `ftyp` box that mean a still image (iPhone HEIC,
// AVIF), not a video — same container family as MP4/MOV.
const IMAGE_FTYP_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

// Old QuickTime files can start with one of these atoms instead of `ftyp`.
const MOV_LEADING_ATOMS = new Set(["moov", "mdat", "wide", "free", "skip"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

// The browser's declared type comes from the file extension, so a renamed
// HEIC arrives as "image/jpeg". Check the magic bytes before any platform
// sees it.
export function contentMatches(contentType: MediaContentType, head: Uint8Array): boolean {
  switch (contentType) {
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n";
    case "image/webp":
      return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
    case "video/mp4":
    case "video/quicktime": {
      const atom = ascii(head, 4, 8);
      if (atom === "ftyp") return !IMAGE_FTYP_BRANDS.has(ascii(head, 8, 12));
      return contentType === "video/quicktime" && MOV_LEADING_ATOMS.has(atom);
    }
  }
}
