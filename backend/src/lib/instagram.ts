import { env } from "./env";

// Instagram API with Instagram Login — a separate OAuth product from the
// Facebook Login flow in facebook.ts. Lets a user connect an Instagram
// Business/Creator account directly, with no Facebook Page in the loop.
// Tokens issued here only work against graph.instagram.com, never
// graph.facebook.com (see service/n8n.ts GRAPH_HOST).
const REDIRECT_URI = `${env.PUBLIC_BACKEND_URL}/api/auth/instagram/callback`;

const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"].join(",");

export function buildAuthUrl(state: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", env.INSTAGRAM_APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export interface ShortLivedToken {
  access_token: string;
  user_id: string;
}

export async function exchangeCodeForToken(code: string): Promise<ShortLivedToken> {
  const body = new URLSearchParams({
    client_id: env.INSTAGRAM_APP_ID,
    client_secret: env.INSTAGRAM_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code,
  });

  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Instagram token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<ShortLivedToken>;
}

export interface LongLivedToken {
  access_token: string;
  expires_in: number;
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", env.INSTAGRAM_APP_SECRET);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Instagram long-lived token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<LongLivedToken>;
}

export interface InstagramProfile {
  user_id: string;
  username: string;
}

export async function fetchProfile(longLivedToken: string): Promise<InstagramProfile> {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", longLivedToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Instagram profile fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<InstagramProfile>;
}
