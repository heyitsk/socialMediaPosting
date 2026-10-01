import { Hono } from "hono";
import { prisma } from "../../db/client";
import { beginConnect, connectRedirect, finishConnect } from "../../lib/connect-state";
import { encrypt } from "../../lib/crypto";
import { pkceChallenge, randomToken } from "../../lib/google-login";
import { logger } from "../../lib/logger";
import { buildAuthUrl, exchangeCodeForToken, fetchChannel, UPLOAD_SCOPE } from "../../lib/youtube";

export const youtubeAuthRoute = new Hono();

youtubeAuthRoute.get("/", async (c) => {
  const codeVerifier = randomToken();
  const started = await beginConnect(c, "youtube", { codeVerifier });
  if ("response" in started) return started.response;
  return c.redirect(buildAuthUrl(started.state, pkceChallenge(codeVerifier)));
});

youtubeAuthRoute.get("/callback", async (c) => {
  const finished = await finishConnect(c, "youtube");
  if ("response" in finished) return finished.response;
  const { ctx } = finished;

  try {
    const token = await exchangeCodeForToken(ctx.code, ctx.codeVerifier ?? "");

    // Google's granular consent lets the user untick the upload checkbox and
    // still "Continue" — the connect would look successful but every post
    // would 403, so reject it here instead.
    if (!token.scope.split(" ").includes(UPLOAD_SCOPE)) {
      return c.redirect(connectRedirect("error=youtube_connect_missing_scope", ctx.workspaceId));
    }
    if (!token.refresh_token) {
      throw new Error(
        "Google returned no refresh_token despite access_type=offline&prompt=consent",
      );
    }

    const channel = await fetchChannel(token.access_token);
    if (!channel) {
      return c.redirect(connectRedirect("error=youtube_connect_no_channel", ctx.workspaceId));
    }

    const tokenFields = {
      accountName: channel.title,
      encryptedAccessToken: encrypt(token.access_token, 1),
      encryptedRefreshToken: encrypt(token.refresh_token, 1),
      keyVersion: 1,
      connectionMethod: "YOUTUBE_LOGIN" as const,
      refreshStrategy: "ON_DEMAND" as const,
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      lastRefreshedAt: new Date(),
    };

    await prisma.connectedAccount.upsert({
      where: {
        workspaceId_platform_platformAccountId_connectionMethod: {
          workspaceId: ctx.workspaceId,
          platform: "YOUTUBE",
          platformAccountId: channel.id,
          connectionMethod: "YOUTUBE_LOGIN",
        },
      },
      update: { ...tokenFields, disconnectedAt: null },
      create: {
        ...tokenFields,
        workspaceId: ctx.workspaceId,
        platform: "YOUTUBE",
        platformAccountId: channel.id,
      },
    });

    return c.redirect(connectRedirect("connected=youtube", ctx.workspaceId));
  } catch (err) {
    logger.error({ platform: "youtube", err }, "OAuth callback failed");
    return c.redirect(connectRedirect("error=youtube_connect_failed", ctx.workspaceId));
  }
});
