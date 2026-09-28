import { Hono } from "hono";
import { prisma } from "../../db/client";
import { beginConnect, connectRedirect, finishConnect } from "../../lib/connect-state";
import { encrypt } from "../../lib/crypto";
import { buildAuthUrl, exchangeCodeForToken, fetchProfile } from "../../lib/linkedin";

export const linkedinAuthRoute = new Hono();

linkedinAuthRoute.get("/", async (c) => {
  const started = await beginConnect(c, "linkedin");
  if ("response" in started) return started.response;
  return c.redirect(buildAuthUrl(started.state));
});

linkedinAuthRoute.get("/callback", async (c) => {
  const finished = await finishConnect(c, "linkedin");
  if ("response" in finished) return finished.response;
  const { ctx } = finished;

  try {
    const token = await exchangeCodeForToken(ctx.code);
    const profile = await fetchProfile(token.access_token);

    await prisma.connectedAccount.upsert({
      where: {
        workspaceId_platform_platformAccountId_connectionMethod: {
          workspaceId: ctx.workspaceId,
          platform: "LINKEDIN",
          platformAccountId: profile.sub,
          connectionMethod: "LINKEDIN_LOGIN",
        },
      },
      update: {
        accountName: profile.name,
        encryptedAccessToken: encrypt(token.access_token, 1),
        keyVersion: 1,
        connectionMethod: "LINKEDIN_LOGIN",
        refreshStrategy: "REQUIRES_RECONNECT",
        tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        lastRefreshedAt: new Date(),
        disconnectedAt: null,
      },
      create: {
        workspaceId: ctx.workspaceId,
        platform: "LINKEDIN",
        platformAccountId: profile.sub,
        accountName: profile.name,
        encryptedAccessToken: encrypt(token.access_token, 1),
        keyVersion: 1,
        connectionMethod: "LINKEDIN_LOGIN",
        refreshStrategy: "REQUIRES_RECONNECT",
        tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        lastRefreshedAt: new Date(),
      },
    });

    return c.redirect(connectRedirect("connected=linkedin", ctx.workspaceId));
  } catch (err) {
    console.error("LinkedIn OAuth callback failed:", err);
    return c.redirect(connectRedirect("error=linkedin_connect_failed", ctx.workspaceId));
  }
});
