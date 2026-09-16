import type { ConnectedAccount, MediaType, Post } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { env } from "../lib/env";

// facebook-poster.json's "Route by Media Type" switch matches on these exact
// strings, not our Prisma MediaType enum values.
const N8N_MEDIA_TYPE: Record<MediaType, string> = {
  TEXT: "TEXT",
  IMAGE: "PHOTO",
  VIDEO: "VIDEO",
  CAROUSEL: "MULTI_PHOTO",
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

export async function dispatchToN8n(payload: FacebookDispatchPayload): Promise<void> {
  const response = await fetch(`${env.N8N_BASE_URL}/webhook/facebook-poster`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`n8n dispatch failed (${response.status}): ${await response.text()}`);
  }
}
