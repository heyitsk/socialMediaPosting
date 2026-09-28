import { Hono } from "hono";
import { prisma } from "../../db/client";
import { beginConnect, connectRedirect, finishConnect } from "../../lib/connect-state";
import { encrypt } from "../../lib/crypto";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
} from "../../lib/threads";

export const threadsAuthRoute = new Hono();

threadsAuthRoute.get("/", async (c) => {
  const started = await beginConnect(c, "threads");
  if ("response" in started) return started.response;
  return c.redirect(buildAuthUrl(started.state));
});

threadsAuthRoute.get("/callback", async (c) => {
  const finished = await finishConnect(c, "threads");
  if ("response" in finished) return finished.response;
  const { ctx } = finished;

  try {
    const shortLived = await exchangeCodeForToken(ctx.code);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);
    const profile = await fetchProfile(longLived.access_token);

    await prisma.connectedAccount.upsert({
      where: {
        workspaceId_platform_platformAccountId_connectionMethod: {
          workspaceId: ctx.workspaceId,
          platform: "THREADS",
          platformAccountId: profile.id,
          connectionMethod: "THREADS_LOGIN",
        },
      },
      update: {
        accountName: profile.username,
        encryptedAccessToken: encrypt(longLived.access_token, 1),
        keyVersion: 1,
        connectionMethod: "THREADS_LOGIN",
        refreshStrategy: "SLIDING_WINDOW",
        tokenExpiresAt: new Date(Date.now() + longLived.expires_in * 1000),
        lastRefreshedAt: new Date(),
        disconnectedAt: null,
      },
      create: {
        workspaceId: ctx.workspaceId,
        platform: "THREADS",
        platformAccountId: profile.id,
        accountName: profile.username,
        encryptedAccessToken: encrypt(longLived.access_token, 1),
        keyVersion: 1,
        connectionMethod: "THREADS_LOGIN",
        refreshStrategy: "SLIDING_WINDOW",
        tokenExpiresAt: new Date(Date.now() + longLived.expires_in * 1000),
        lastRefreshedAt: new Date(),
      },
    });

    return c.redirect(connectRedirect("connected=threads", ctx.workspaceId));
  } catch (err) {
    console.error("Threads OAuth callback failed:", err);
    return c.redirect(connectRedirect("error=threads_connect_failed", ctx.workspaceId));
  }
});
