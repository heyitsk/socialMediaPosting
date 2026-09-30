import type { ConnectedAccount, ContentKind, MediaType, Platform } from "@prisma/client";

// The one place that says what each platform's n8n workflow can post. The
// composer renders from GET /api/capabilities instead of keeping its own copy
// (it used to, and drifted — see websitePlan.md §10.3).

export type PostablePlatform = Extract<
  Platform,
  "FACEBOOK" | "INSTAGRAM" | "THREADS" | "LINKEDIN" | "YOUTUBE"
>;

export const POSTABLE_PLATFORMS: readonly PostablePlatform[] = [
  "FACEBOOK",
  "INSTAGRAM",
  "THREADS",
  "LINKEDIN",
  "YOUTUBE",
];

export const CONTENT_KINDS: readonly ContentKind[] = [
  "TEXT",
  "IMAGE",
  "CAROUSEL",
  "VIDEO",
  "STORY",
];

// Content kind → the MediaType each platform's workflow is sent. More than one
// entry means the user picks (YouTube VIDEO vs SHORTS); the first is the
// default. A missing kind means the platform can't take it.
export const MEDIA_TYPES: Record<
  PostablePlatform,
  Partial<Record<ContentKind, readonly MediaType[]>>
> = {
  FACEBOOK: { TEXT: ["TEXT"], IMAGE: ["IMAGE"], CAROUSEL: ["CAROUSEL"], VIDEO: ["VIDEO"] },
  // Every Instagram video is a Reel; Stories are Instagram-only.
  INSTAGRAM: { IMAGE: ["IMAGE"], CAROUSEL: ["CAROUSEL"], VIDEO: ["REELS"], STORY: ["STORIES"] },
  THREADS: { TEXT: ["TEXT"], IMAGE: ["IMAGE"], CAROUSEL: ["CAROUSEL"], VIDEO: ["VIDEO"] },
  LINKEDIN: { TEXT: ["TEXT"], IMAGE: ["IMAGE"], CAROUSEL: ["CAROUSEL"], VIDEO: ["VIDEO"] },
  YOUTUBE: { VIDEO: ["VIDEO", "SHORTS"] },
};

// websitePlan.md §4 validation matrix. YouTube's is the description; its
// title (100) is checked by the youtubeOptions schema.
export const CAPTION_LIMITS: Record<PostablePlatform, number> = {
  FACEBOOK: 63_206,
  INSTAGRAM: 2_200,
  THREADS: 500,
  LINKEDIN: 3_000,
  YOUTUBE: 5_000,
};

export const INSTAGRAM_MAX_HASHTAGS = 30;

// Instagram's 10 is documented; Threads' and LinkedIn's 20 are their API
// limits. Facebook's multi-photo flow has no documented cap, so it's held to
// Instagram's 10 until tested higher.
export const CAROUSEL_LIMITS: Record<PostablePlatform, { min: number; max: number }> = {
  FACEBOOK: { min: 2, max: 10 },
  INSTAGRAM: { min: 2, max: 10 },
  THREADS: { min: 2, max: 20 },
  LINKEDIN: { min: 2, max: 20 },
  YOUTUBE: { min: 2, max: 2 }, // unused — YouTube has no CAROUSEL entry above
};

// How each surface (platform + media type) shows media of a given shape —
// websitePlan.md §12.2. Ratios are width / height. Re-check against the
// platforms' docs now and then; these change.
export interface SurfaceFit {
  // Shown whole within this range.
  display: { min: number; max: number };
  // Outside `display`, the platform either crops to the nearest edge of the
  // range or shows the whole thing with bars around it.
  beyond: "CROP" | "LETTERBOX";
  // The publishing API rejects anything outside this range.
  accepted?: { min: number; max: number };
  // Share of the frame's height covered by the platform's own buttons and
  // captions (full-screen vertical surfaces).
  safeZone?: { top: number; bottom: number };
  // Instagram shows every carousel item at the first item's shape.
  carouselUsesFirstRatio?: boolean;
  // Shapes the composer's cropper offers, best first. A crop or pad must use
  // one of these (routes/post-groups.ts).
  presets: number[];
}

const PORTRAIT = 4 / 5;
const LANDSCAPE = 1.91;
const VERTICAL = 9 / 16;
const WIDESCREEN = 16 / 9;

const FEED_IMAGE: SurfaceFit = {
  display: { min: PORTRAIT, max: LANDSCAPE },
  beyond: "CROP",
  presets: [PORTRAIT, 1, LANDSCAPE],
};
const FEED_VIDEO: SurfaceFit = {
  display: { min: PORTRAIT, max: WIDESCREEN },
  beyond: "CROP",
  presets: [PORTRAIT, 1, WIDESCREEN],
};
const FULL_SCREEN = { min: VERTICAL, max: VERTICAL };

export const SURFACE_FITS: Record<PostablePlatform, Partial<Record<MediaType, SurfaceFit>>> = {
  FACEBOOK: { IMAGE: FEED_IMAGE, CAROUSEL: FEED_IMAGE, VIDEO: FEED_VIDEO },
  INSTAGRAM: {
    IMAGE: { ...FEED_IMAGE, accepted: { min: PORTRAIT, max: LANDSCAPE } },
    CAROUSEL: {
      ...FEED_IMAGE,
      accepted: { min: PORTRAIT, max: LANDSCAPE },
      carouselUsesFirstRatio: true,
    },
    REELS: {
      display: FULL_SCREEN,
      beyond: "LETTERBOX",
      safeZone: { top: 0.14, bottom: 0.2 },
      presets: [VERTICAL],
    },
    STORIES: {
      display: FULL_SCREEN,
      beyond: "LETTERBOX",
      safeZone: { top: 0.14, bottom: 0.14 },
      presets: [VERTICAL],
    },
  },
  THREADS: { IMAGE: FEED_IMAGE, CAROUSEL: FEED_IMAGE, VIDEO: FEED_VIDEO },
  LINKEDIN: {
    IMAGE: FEED_IMAGE,
    CAROUSEL: FEED_IMAGE,
    // LinkedIn's video API takes 1:2.4 to 2.4:1.
    VIDEO: { ...FEED_VIDEO, accepted: { min: 1 / 2.4, max: 2.4 } },
  },
  YOUTUBE: {
    VIDEO: {
      display: { min: WIDESCREEN, max: WIDESCREEN },
      beyond: "LETTERBOX",
      presets: [WIDESCREEN],
    },
    // Vertical/square only — the Shorts check in routes/post-groups.ts covers
    // that together with the duration, so no `accepted` here.
    SHORTS: {
      display: FULL_SCREEN,
      beyond: "LETTERBOX",
      safeZone: { top: 0.14, bottom: 0.25 },
      presets: [VERTICAL, 1],
    },
  },
};

export function surfaceFit(platform: PostablePlatform, mediaType: MediaType): SurfaceFit | null {
  return SURFACE_FITS[platform][mediaType] ?? null;
}

// 1080x1350 is exactly 4:5, but an export at 1080x1349 shouldn't be turned
// away, and platforms allow for that rounding too.
const RATIO_TOLERANCE = 0.01;

export function ratioWithin(ratio: number, range: { min: number; max: number }): boolean {
  return ratio >= range.min * (1 - RATIO_TOLERANCE) && ratio <= range.max * (1 + RATIO_TOLERANCE);
}

const NAMED_RATIOS: [number, string][] = [
  [9 / 16, "9:16"],
  [2 / 3, "2:3"],
  [3 / 4, "3:4"],
  [4 / 5, "4:5"],
  [1, "1:1"],
  [5 / 4, "5:4"],
  [4 / 3, "4:3"],
  [3 / 2, "3:2"],
  [16 / 9, "16:9"],
  [1.91, "1.91:1"],
];

// "4:5" for the usual shapes, "1.43:1" otherwise.
export function formatRatio(ratio: number): string {
  const named = NAMED_RATIOS.find(([value]) => Math.abs(ratio / value - 1) <= RATIO_TOLERANCE);
  if (named) return named[1];
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

export const PLATFORM_NAMES: Record<PostablePlatform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
};

// Shorts: YouTube classifies vertical/square videos up to 3 minutes as Shorts.
export const SHORTS_MAX_DURATION_SECONDS = 180;

// A token this close to expiring is treated as expired — dispatch (n8n.ts)
// and the integrations list both use it.
export const TOKEN_EXPIRY_BUFFER_MS = 24 * 60 * 60 * 1000;

export function isPostablePlatform(platform: Platform): platform is PostablePlatform {
  return (POSTABLE_PLATFORMS as readonly Platform[]).includes(platform);
}

export function mediaTypesFor(platform: Platform, kind: ContentKind): readonly MediaType[] {
  return isPostablePlatform(platform) ? (MEDIA_TYPES[platform][kind] ?? []) : [];
}

// Code points, not UTF-16 units — an emoji counts once, like the platforms count it.
export function captionLength(caption: string): number {
  return [...caption].length;
}

export function countHashtags(caption: string): number {
  return caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

// Why an account can't be posted to at `at` (now, or a scheduled time), or
// null if it can. For ON_DEMAND (YouTube) the access token's own expiry is
// irrelevant — it's refreshed on use — so the signal is a refresh token
// Google rejected and service/youtube-token.ts cleared. LinkedIn issues no
// refresh token at all, so an expiring one needs the OAuth consent redone.
export function reconnectReason(
  account: Pick<ConnectedAccount, "refreshStrategy" | "tokenExpiresAt" | "encryptedRefreshToken">,
  at: Date = new Date(),
): string | null {
  if (account.refreshStrategy === "ON_DEMAND") {
    return account.encryptedRefreshToken == null
      ? "Access was revoked — reconnect the account"
      : null;
  }
  if (
    (account.refreshStrategy === "REQUIRES_RECONNECT" ||
      account.refreshStrategy === "SLIDING_WINDOW") &&
    account.tokenExpiresAt != null &&
    account.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < at.getTime()
  ) {
    return at.getTime() > Date.now() + 60_000
      ? "Token expires before the scheduled time — reconnect the account first"
      : "Token expired or expiring soon — reconnect the account";
  }
  return null;
}
