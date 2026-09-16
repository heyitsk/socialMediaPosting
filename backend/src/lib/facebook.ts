import { env } from "./env";

const GRAPH_URL = `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;
const REDIRECT_URI = `${env.PUBLIC_BACKEND_URL}/api/auth/facebook/callback`;

// Scopes cover both Facebook Page posting and Instagram business posting —
// Instagram rides on this same dialog, no separate consent screen
// (websitePlan.md §2.1/§2.2).
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
].join(",");

export function buildAuthUrl(state: string): string {
  const url = new URL(`https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", env.META_APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Facebook Graph API error (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const data = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });
  return data.access_token;
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const data = await graphGet<{ access_token: string }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  return data.access_token;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

export async function fetchPages(userToken: string): Promise<FacebookPage[]> {
  const data = await graphGet<{ data: FacebookPage[] }>("/me/accounts", {
    access_token: userToken,
  });
  return data.data;
}

// "processing" | "ready" | "error" — the video isn't actually live until this
// reports "ready", even though POST /{page_id}/videos returns an id immediately
// (websitePlan.md §6 "Async Media Processing Poller").
export async function getVideoStatus(pageToken: string, videoId: string): Promise<string> {
  const data = await graphGet<{ status: { video_status: string } }>(`/${videoId}`, {
    fields: "status",
    access_token: pageToken,
  });
  return data.status.video_status;
}

export async function fetchInstagramBusinessAccount(
  pageId: string,
  pageToken: string,
): Promise<{ id: string; username: string } | null> {
  const data = await graphGet<{
    instagram_business_account?: { id: string; username?: string };
  }>(`/${pageId}`, {
    fields: "instagram_business_account{id,username}",
    access_token: pageToken,
  });

  if (!data.instagram_business_account) return null;
  return {
    id: data.instagram_business_account.id,
    username: data.instagram_business_account.username ?? data.instagram_business_account.id,
  };
}
