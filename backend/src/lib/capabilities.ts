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
