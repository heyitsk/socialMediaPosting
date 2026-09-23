import { env } from "./env";

// Google OAuth 2.0 + YouTube Data API v3. Unlike every other platform so far,
// Google issues a short-lived (~1h) access token PLUS a long-lived refresh
// token — see RefreshStrategy.ON_DEMAND in schema.prisma and
// service/youtube-token.ts, which swaps the refresh token for a fresh access
// token right before each use instead of running a background refresh job.
const REDIRECT_URI = `${env.PUBLIC_BACKEND_URL}/api/auth/youtube/callback`;

export const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

// youtube.upload alone can't read anything back — youtube.readonly is what
// lets fetchChannel resolve the channel id/name at connect time and lets
// getVideoStatus poll processing status after upload.
const SCOPES = [UPLOAD_SCOPE, "https://www.googleapis.com/auth/youtube.readonly"].join(" ");

export function buildAuthUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  // offline = issue a refresh token at all; consent = re-issue one on every
  // connect, not just the very first — otherwise a reconnect after
  // disconnect silently comes back with no refresh token.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export interface GoogleToken {
  access_token: string;
  expires_in: number;
  // Space-separated — Google's consent screen lets the user untick
  // individual scopes, so what was granted can be less than what was asked.
  scope: string;
  refresh_token?: string;
}

export async function exchangeCodeForToken(code: string): Promise<GoogleToken> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<GoogleToken>;
}

// Thrown when Google rejects the refresh token itself (revoked from the
// Google account's security page, password change, or the 7-day expiry
// Google applies while the OAuth consent screen is still in "Testing") —
// only a fresh OAuth consent fixes this, unlike a transient network error.
export class RefreshTokenRevokedError extends Error {}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && text.includes("invalid_grant")) {
      throw new RefreshTokenRevokedError(`Google refresh token revoked or expired: ${text}`);
    }
    throw new Error(`Google token refresh failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<{ access_token: string; expires_in: number }>;
}

export interface YouTubeChannel {
  id: string;
  title: string;
}

// mine=true returns the channel the user picked on Google's consent screen —
// a Google account with several Brand Account channels gets a channel picker
// there, so one OAuth run = one channel, same as one LinkedIn member.
// Returns null for a Google account that has never created a channel.
export async function fetchChannel(accessToken: string): Promise<YouTubeChannel | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`YouTube channel fetch failed (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as { items?: { id: string; snippet: { title: string } }[] };
  const channel = data.items?.[0];
  return channel ? { id: channel.id, title: channel.snippet.title } : null;
}

export type YouTubeVideoStatus =
  | { state: "ready" }
  | { state: "processing" }
  | { state: "error"; reason: string };

// youtube-poster.json's upload call returns as soon as the bytes land
// (uploadStatus "uploaded") — YouTube keeps processing afterwards and can
// still fail or reject the video (duplicate, copyright, too long for an
// unverified channel, etc.). Polled by queue/video-status-worker.ts, same as
// Facebook/LinkedIn.
export async function getVideoStatus(accessToken: string, videoId: string): Promise<YouTubeVideoStatus> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "status");
  url.searchParams.set("id", videoId);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`YouTube video status fetch failed (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as {
    items?: { status: { uploadStatus: string; failureReason?: string; rejectionReason?: string } }[];
  };
  const status = data.items?.[0]?.status;

  if (!status) return { state: "error", reason: "Video not found on YouTube — it may have been deleted" };
  if (status.uploadStatus === "processed") return { state: "ready" };
  if (status.uploadStatus === "uploaded") return { state: "processing" };
  return {
    state: "error",
    reason: `YouTube ${status.uploadStatus} the video${
      status.failureReason || status.rejectionReason ? ` (${status.failureReason ?? status.rejectionReason})` : ""
    }`,
  };
}
