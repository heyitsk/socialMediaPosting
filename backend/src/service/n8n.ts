import type { ConnectedAccount, ConnectionMethod, MediaType, Post } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { env } from "../lib/env";

// facebook-poster.json's "Route by Media Type" switch matches on these exact
// strings, not our Prisma MediaType enum values.
const N8N_MEDIA_TYPE: Record<MediaType, string> = {
  TEXT: "TEXT",
  IMAGE: "PHOTO",
  VIDEO: "VIDEO",
  CAROUSEL: "MULTI_PHOTO",
  REELS: "REELS",
  STORIES: "STORIES",
};

// instagram-poster.json's HTTP Request nodes build their URL from this host —
// Facebook-Page-issued IG tokens only work against graph.facebook.com, while
// Instagram Login tokens only work against graph.instagram.com (see
// lib/instagram.ts).
const GRAPH_HOST: Record<Extract<ConnectionMethod, "FACEBOOK_PAGE" | "INSTAGRAM_LOGIN">, string> = {
  FACEBOOK_PAGE: "https://graph.facebook.com",
  INSTAGRAM_LOGIN: "https://graph.instagram.com",
};

export interface FacebookDispatchPayload {
  post_id: string;
  user_id: string;
  platform: "facebook";
  content: string;
  media_type: string;
  media_urls: string[];
  token: { page_id: string; access_token: string };
  callback_url: string;
}

export function buildFacebookPayload(
  post: Post,
  connectedAccount: ConnectedAccount,
): FacebookDispatchPayload {
  const accessToken = decrypt(connectedAccount.encryptedAccessToken, connectedAccount.keyVersion);

  return {
    post_id: post.id,
    user_id: post.userId,
    platform: "facebook",
    content: post.caption,
    media_type: N8N_MEDIA_TYPE[post.mediaType],
    media_urls: post.mediaUrls as string[],
    token: {
      page_id: connectedAccount.platformAccountId,
      access_token: accessToken,
    },
    callback_url: `${env.PUBLIC_BACKEND_URL}/api/webhooks/n8n-callback`,
  };
}

export interface InstagramDispatchPayload {
  post_id: string;
  user_id: string;
  platform: "instagram";
  content: string;
  media_type: string;
  media_urls: string[];
  token: { ig_business_id: string; access_token: string; graph_host: string };
  callback_url: string;
}

// Standalone Instagram Login tokens expire after ~60 days and there's no
// proactive refresh worker yet — fail fast with a clear error here rather
// than dispatching a doomed request to n8n (see websitePlan.md token
// refresh notes; SLIDING_WINDOW refresh automation is a follow-up). Exported
// so routes/integrations.ts can flag the same "needs reconnect" window to
// the frontend before the user even tries to post.
export const TOKEN_EXPIRY_BUFFER_MS = 24 * 60 * 60 * 1000;

export function buildInstagramPayload(
  post: Post,
  connectedAccount: ConnectedAccount,
): InstagramDispatchPayload {
  if (
    connectedAccount.refreshStrategy === "SLIDING_WINDOW" &&
    connectedAccount.tokenExpiresAt &&
    connectedAccount.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now()
  ) {
    throw new Error("Instagram token expired or expiring soon — reconnect the account");
  }

  const accessToken = decrypt(connectedAccount.encryptedAccessToken, connectedAccount.keyVersion);

  return {
    post_id: post.id,
    user_id: post.userId,
    platform: "instagram",
    content: post.caption,
    // Unlike Facebook's PHOTO/MULTI_PHOTO renaming, instagram-poster.json's
    // Switch node matches on our Prisma MediaType values verbatim — no
    // N8N_MEDIA_TYPE lookup here.
    media_type: post.mediaType,
    media_urls: post.mediaUrls as string[],
    token: {
      ig_business_id: connectedAccount.platformAccountId,
      access_token: accessToken,
      // connectionMethod is only ever FACEBOOK_PAGE/INSTAGRAM_LOGIN for an
      // Instagram-platform account — THREADS_LOGIN never reaches here.
      graph_host: GRAPH_HOST[connectedAccount.connectionMethod as "FACEBOOK_PAGE" | "INSTAGRAM_LOGIN"],
    },
    callback_url: `${env.PUBLIC_BACKEND_URL}/api/webhooks/n8n-callback`,
  };
}

export interface ThreadsDispatchPayload {
  post_id: string;
  user_id: string;
  platform: "threads";
  content: string;
  media_type: string;
  media_urls: string[];
  token: { access_token: string };
  callback_url: string;
}

// threads-poster.json posts to the caller's own /me/threads — no page/business
// id to resolve, so this payload is simpler than Facebook's/Instagram's.
// media_type values (TEXT/IMAGE/VIDEO) already match the Prisma MediaType
// enum verbatim, same as Instagram — no N8N_MEDIA_TYPE lookup needed.
export function buildThreadsPayload(
  post: Post,
  connectedAccount: ConnectedAccount,
): ThreadsDispatchPayload {
  if (
    connectedAccount.refreshStrategy === "SLIDING_WINDOW" &&
    connectedAccount.tokenExpiresAt &&
    connectedAccount.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now()
  ) {
    throw new Error("Threads token expired or expiring soon — reconnect the account");
  }

  const accessToken = decrypt(connectedAccount.encryptedAccessToken, connectedAccount.keyVersion);

  return {
    post_id: post.id,
    user_id: post.userId,
    platform: "threads",
    content: post.caption,
    media_type: post.mediaType,
    media_urls: post.mediaUrls as string[],
    token: { access_token: accessToken },
    callback_url: `${env.PUBLIC_BACKEND_URL}/api/webhooks/n8n-callback`,
  };
}

export interface LinkedInDispatchPayload {
  post_id: string;
  user_id: string;
  platform: "linkedin";
  content: string;
  media_type: string;
  media_urls: string[];
  token: { access_token: string; author_urn: string };
  callback_url: string;
}

// linkedin-poster.json's Switch node matches media_type verbatim, same as
// Instagram/Threads — no N8N_MEDIA_TYPE lookup needed.
//
// LinkedIn access tokens have no refresh token at all (see
// RefreshStrategy.REQUIRES_RECONNECT in schema.prisma) — reuses Instagram's/
// Threads' TOKEN_EXPIRY_BUFFER_MS check so a doomed dispatch fails fast here
// with a clear "reconnect" error instead of erroring out inside n8n.
export function buildLinkedInPayload(
  post: Post,
  connectedAccount: ConnectedAccount,
): LinkedInDispatchPayload {
  if (
    connectedAccount.refreshStrategy === "REQUIRES_RECONNECT" &&
    connectedAccount.tokenExpiresAt &&
    connectedAccount.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now()
  ) {
    throw new Error("LinkedIn token expired or expiring soon — reconnect the account");
  }

  const accessToken = decrypt(connectedAccount.encryptedAccessToken, connectedAccount.keyVersion);

  return {
    post_id: post.id,
    user_id: post.userId,
    platform: "linkedin",
    content: post.caption,
    media_type: post.mediaType,
    media_urls: post.mediaUrls as string[],
    token: {
      access_token: accessToken,
      author_urn: `urn:li:person:${connectedAccount.platformAccountId}`,
    },
    callback_url: `${env.PUBLIC_BACKEND_URL}/api/webhooks/n8n-callback`,
  };
}

async function postToN8n(webhookPath: string, payload: unknown): Promise<void> {
  const response = await fetch(`${env.N8N_BASE_URL}/webhook/${webhookPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`n8n dispatch failed (${response.status}): ${await response.text()}`);
  }
}

export async function dispatchToN8n(payload: FacebookDispatchPayload): Promise<void> {
  await postToN8n("facebook-poster", payload);
}

export async function dispatchInstagramToN8n(payload: InstagramDispatchPayload): Promise<void> {
  await postToN8n("instagram-poster", payload);
}

export async function dispatchThreadsToN8n(payload: ThreadsDispatchPayload): Promise<void> {
  await postToN8n("threads-poster", payload);
}

export async function dispatchLinkedInToN8n(payload: LinkedInDispatchPayload): Promise<void> {
  await postToN8n("linkedin-poster", payload);
}
