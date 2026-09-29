import type { components } from "@/lib/api-schema";

export type PostGroup = components["schemas"]["PostGroup"];
export type PostTarget = components["schemas"]["PostTarget"];
export type PostStatus = PostGroup["status"];
export type ContentKind = PostGroup["contentKind"];
export type MediaType = PostTarget["mediaType"];
export type Platform = PostTarget["platform"];
export type Capabilities = components["schemas"]["Capabilities"];
export type PlatformCapabilities = Capabilities["platforms"][number];
export type YouTubeOptions = components["schemas"]["YouTubeOptions"];
export type PostGroupValidationError = components["schemas"]["PostGroupValidationError"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  PINTEREST: "Pinterest",
};

export const CONTENT_KINDS: { kind: ContentKind; label: string; description: string }[] = [
  { kind: "TEXT", label: "Text", description: "Words only" },
  { kind: "IMAGE", label: "Image", description: "One photo" },
  { kind: "CAROUSEL", label: "Carousel", description: "Several photos" },
  { kind: "VIDEO", label: "Video", description: "Reels on Instagram" },
  { kind: "STORY", label: "Story", description: "Instagram only" },
];

export const CONTENT_KIND_LABELS = Object.fromEntries(
  CONTENT_KINDS.map(({ kind, label }) => [kind, label]),
) as Record<ContentKind, string>;

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  TEXT: "Text",
  IMAGE: "Image",
  VIDEO: "Video",
  CAROUSEL: "Carousel",
  REELS: "Reel",
  STORIES: "Story",
  SHORTS: "Short",
};

export const STATUS_LABELS: Record<PostStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PROCESSING: "Posting…",
  PUBLISHED: "Published",
  PARTIAL_FAILURE: "Partly failed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const STATUS_VARIANT: Record<
  PostStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DRAFT: "outline",
  SCHEDULED: "outline",
  PROCESSING: "secondary",
  PUBLISHED: "default",
  PARTIAL_FAILURE: "destructive",
  FAILED: "destructive",
  CANCELLED: "outline",
};

// Mirrors backend youtubeOptionsSchema in routes/post-schemas.ts.
export const YOUTUBE_TITLE_MAX = 100;

export const YOUTUBE_PRIVACY_OPTIONS: { value: YouTubeOptions["privacyStatus"]; label: string }[] =
  [
    { value: "private", label: "Private" },
    { value: "unlisted", label: "Unlisted" },
    { value: "public", label: "Public" },
  ];

// Mirrors backend YOUTUBE_CATEGORY_IDS in routes/post-schemas.ts.
export const YOUTUBE_CATEGORIES: { value: YouTubeOptions["categoryId"]; label: string }[] = [
  { value: "1", label: "Film & Animation" },
  { value: "2", label: "Autos & Vehicles" },
  { value: "10", label: "Music" },
  { value: "15", label: "Pets & Animals" },
  { value: "17", label: "Sports" },
  { value: "19", label: "Travel & Events" },
  { value: "20", label: "Gaming" },
  { value: "22", label: "People & Blogs" },
  { value: "23", label: "Comedy" },
  { value: "24", label: "Entertainment" },
  { value: "25", label: "News & Politics" },
  { value: "26", label: "Howto & Style" },
  { value: "27", label: "Education" },
  { value: "28", label: "Science & Technology" },
  { value: "29", label: "Nonprofits & Activism" },
];

// Same counting as the backend (lib/capabilities.ts): code points, so an emoji
// is one character, like the platforms count it.
export function captionLength(caption: string): number {
  return [...caption].length;
}

export function countHashtags(caption: string): number {
  return caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

// The newest log explains the current state — older ones are earlier attempts.
export function latestError(target: PostTarget): string | null {
  const latest = target.logs.at(-1);
  return target.status === "FAILED" && latest?.status === "FAILED" ? latest.errorMessage : null;
}
