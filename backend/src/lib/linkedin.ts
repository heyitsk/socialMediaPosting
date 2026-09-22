import { env } from "./env";

// Sign In with LinkedIn using OpenID Connect + "Share on LinkedIn" — unlike
// Facebook/Instagram/Threads, there's no separate Page/Business resolution
// step or long-lived-token exchange call. The access token is scoped
// directly to the authenticated member and is valid for 60 days with NO
// refresh token issued at all (see RefreshStrategy.REQUIRES_RECONNECT in
// schema.prisma — the member has to redo the OAuth consent screen once it
// expires, there's nothing to proactively refresh).
const REDIRECT_URI = `${env.PUBLIC_BACKEND_URL}/api/auth/linkedin/callback`;

// openid+profile let us resolve the member's own urn:li:person:{sub} via
// /v2/userinfo instead of asking for it to be pasted in manually (see
// fetchProfile below); w_member_social is what actually authorizes posting.
const SCOPES = ["openid", "profile", "w_member_social"].join(" ");

export function buildAuthUrl(state: string): string {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.LINKEDIN_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES);
  return url.toString();
}

export interface LinkedInToken {
  access_token: string;
  expires_in: number;
}

export async function exchangeCodeForToken(code: string): Promise<LinkedInToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`LinkedIn token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<LinkedInToken>;
}

export interface LinkedInProfile {
  sub: string; // person URN suffix -> urn:li:person:{sub}
  name: string;
}

export async function fetchProfile(accessToken: string): Promise<LinkedInProfile> {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`LinkedIn profile fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<LinkedInProfile>;
}

// Bump periodically per LinkedIn's versioning docs (supported for a minimum
// of one year) — kept in sync with the same constant hardcoded into every
// HTTP node's LinkedIn-Version header in linkedin-poster.json.
const LINKEDIN_VERSION = "202609";

// Normalizes LinkedIn's videos.status ("AVAILABLE" | "PROCESSING_FAILED" |
// still processing) onto the same "ready"|"error"|"processing" union
// lib/facebook.ts's getVideoStatus returns, so
// queue/video-status-worker.ts can branch on either platform uniformly.
export async function getVideoStatus(accessToken: string, videoUrn: string): Promise<string> {
  const response = await fetch(`https://api.linkedin.com/rest/videos/${encodeURIComponent(videoUrn)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!response.ok) {
    throw new Error(`LinkedIn video status fetch failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { status: string };
  if (data.status === "AVAILABLE") return "ready";
  if (data.status === "PROCESSING_FAILED") return "error";
  return "processing";
}
