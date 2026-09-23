import type { ConnectedAccount } from "@prisma/client";
import { prisma } from "../db/client";
import { decrypt, encrypt } from "../lib/crypto";
import { RefreshTokenRevokedError, refreshAccessToken } from "../lib/youtube";

// Google access tokens live ~1h. Refreshing a little early means a token
// handed to n8n won't expire between dispatch and the resumable-upload init
// call. (It CAN still expire mid-upload for a very long upload — Google only
// checks the token when the upload session is created, so that's fine.)
const ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

// RefreshStrategy.ON_DEMAND (schema.prisma): no background job — the stored
// access token is reused while it's still valid, otherwise the refresh token
// is exchanged for a new one right here and persisted for the next caller.
// Used by both the dispatch path (service/n8n.ts) and the post-upload status
// poller (queue/video-status-worker.ts).
export async function getFreshYouTubeAccessToken(account: ConnectedAccount): Promise<string> {
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() - ACCESS_TOKEN_SKEW_MS > Date.now()) {
    return decrypt(account.encryptedAccessToken, account.keyVersion);
  }

  if (!account.encryptedRefreshToken) {
    throw new Error("YouTube refresh token missing — reconnect the account");
  }

  let token: { access_token: string; expires_in: number };
  try {
    token = await refreshAccessToken(decrypt(account.encryptedRefreshToken, account.keyVersion));
  } catch (err) {
    if (err instanceof RefreshTokenRevokedError) {
      // Clearing the refresh token is what routes/integrations.ts reads as
      // needsReconnect for ON_DEMAND accounts — surfaces the Reconnect button
      // instead of every future post failing the same way.
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { encryptedRefreshToken: null },
      });
      throw new Error("YouTube access was revoked or expired — reconnect the account");
    }
    throw err;
  }

  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      // Same keyVersion as the row's refresh token — keyVersion is per-row,
      // so re-encrypting only one of the two under a newer key would make
      // the other undecryptable.
      encryptedAccessToken: encrypt(token.access_token, account.keyVersion),
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      lastRefreshedAt: new Date(),
    },
  });

  return token.access_token;
}
