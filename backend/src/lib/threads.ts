import { env } from "./env";

// Threads API with Threads Login — a third distinct OAuth product from
// Facebook Login (facebook.ts) and Instagram API with Instagram Login
// (instagram.ts), issued under the "Threads API" product on the same Meta
// App as META_APP_ID/SECRET. Threads posting is tied directly to the
// authenticated user's own token (`/me/threads`) — there's no separate
// Page/Business ID to resolve, unlike Facebook/Instagram.
const REDIRECT_URI = `${env.PUBLIC_BACKEND_URL}/api/auth/threads/callback`;

const SCOPES = ["threads_basic", "threads_content_publish"].join(",");

export function buildAuthUrl(state: string): string {
  const url = new URL("https://threads.net/oauth/authorize");
  url.searchParams.set("client_id", env.THREADS_APP_ID);
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
    client_id: env.THREADS_APP_ID,
    client_secret: env.THREADS_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code,
  });

  const response = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Threads token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<ShortLivedToken>;
}

export interface LongLivedToken {
  access_token: string;
  expires_in: number;
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<LongLivedToken> {
  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", env.THREADS_APP_SECRET);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Threads long-lived token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<LongLivedToken>;
}

// Not wired to a background worker yet (same deferred-refresh state as
// Instagram Login — see buildInstagramPayload's TOKEN_EXPIRY_BUFFER_MS
// comment in service/n8n.ts). Long-lived tokens last ~60 days and can be
// refreshed once they're at least 24h old; exported now so a future sliding-
// window worker can call it without touching this file again.
export async function refreshLongLivedToken(currentToken: string): Promise<LongLivedToken> {
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", currentToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Threads token refresh failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<LongLivedToken>;
}

export interface ThreadsProfile {
  id: string;
  username: string;
}

export async function fetchProfile(longLivedToken: string): Promise<ThreadsProfile> {
  const url = new URL("https://graph.threads.net/v1.0/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", longLivedToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Threads profile fetch failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<ThreadsProfile>;
}
