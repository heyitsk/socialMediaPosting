import { Hono } from "hono";
import { prisma } from "../../db/client";
import { beginConnect, connectRedirect, finishConnect } from "../../lib/connect-state";
import { encrypt } from "../../lib/crypto";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
} from "../../lib/instagram";

export const instagramAuthRoute = new Hono();

instagramAuthRoute.get("/", async (c) => {
  const started = await beginConnect(c, "instagram");
  if ("response" in started) return started.response;
  return c.redirect(buildAuthUrl(started.state));
});

instagramAuthRoute.get("/callback", async (c) => {
  const finished = await finishConnect(c, "instagram");
  if ("response" in finished) return finished.response;
  const { ctx } = finished;

  try {
    const shortLived = await exchangeCodeForToken(ctx.code);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);
    const profile = await fetchProfile(longLived.access_token);

    const duplicate = await prisma.connectedAccount.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        platform: "INSTAGRAM",
        accountName: profile.username,
        connectionMethod: { not: "INSTAGRAM_LOGIN" },
        disconnectedAt: null,
      },
    });

    await prisma.connectedAccount.upsert({
      where: {
        workspaceId_platform_platformAccountId_connectionMethod: {
          workspaceId: ctx.workspaceId,
          platform: "INSTAGRAM",
          platformAccountId: profile.user_id,
          connectionMethod: "INSTAGRAM_LOGIN",
        },
      },
      update: {
        accountName: profile.username,
        encryptedAccessToken: encrypt(longLived.access_token, 1),
        keyVersion: 1,
        connectionMethod: "INSTAGRAM_LOGIN",
        refreshStrategy: "SLIDING_WINDOW",
        tokenExpiresAt: new Date(Date.now() + longLived.expires_in * 1000),
        lastRefreshedAt: new Date(),
        disconnectedAt: null,
      },
      create: {
        workspaceId: ctx.workspaceId,
        platform: "INSTAGRAM",
        platformAccountId: profile.user_id,
        accountName: profile.username,
        encryptedAccessToken: encrypt(longLived.access_token, 1),
        keyVersion: 1,
        connectionMethod: "INSTAGRAM_LOGIN",
        refreshStrategy: "SLIDING_WINDOW",
        tokenExpiresAt: new Date(Date.now() + longLived.expires_in * 1000),
        lastRefreshedAt: new Date(),
      },
    });

    const redirectQuery = duplicate ? "connected=instagram&duplicate=1" : "connected=instagram";
    return c.redirect(connectRedirect(redirectQuery, ctx.workspaceId));
  } catch (err) {
    console.error("Instagram OAuth callback failed:", err);
    return c.redirect(connectRedirect("error=instagram_connect_failed", ctx.workspaceId));
  }
});
