import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getOrCreateDefaultUser } from "../../db/users";
import { prisma } from "../../db/client";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
} from "../../lib/threads";
import { encrypt } from "../../lib/crypto";
import { env } from "../../lib/env";
import { redis } from "../../lib/redis";

const STATE_TTL_SECONDS = 300;

function stateKey(state: string): string {
  return `oauth:state:threads:${state}`;
}

export const threadsAuthRoute = new Hono();

threadsAuthRoute.get("/", async (c) => {
  const state = randomBytes(16).toString("hex");
  await redis.set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);
  return c.redirect(buildAuthUrl(state));
});

threadsAuthRoute.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const deniedError = c.req.query("error");

  if (deniedError || !code || !state) {
    return c.redirect(`${env.FRONTEND_URL}/?error=threads_connect_denied`);
  }

  const key = stateKey(state);
  const validState = await redis.get(key);
  await redis.del(key);

  if (!validState) {
    return c.redirect(`${env.FRONTEND_URL}/?error=threads_connect_invalid_state`);
  }

  try {
    const shortLived = await exchangeCodeForToken(code);
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);
    const profile = await fetchProfile(longLived.access_token);
    const user = await getOrCreateDefaultUser();

    await prisma.connectedAccount.upsert({
      where: {
        userId_platform_platformAccountId_connectionMethod: {
          userId: user.id,
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
        userId: user.id,
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

    return c.redirect(`${env.FRONTEND_URL}/?connected=threads`);
  } catch (err) {
    console.error("Threads OAuth callback failed:", err);
    return c.redirect(`${env.FRONTEND_URL}/?error=threads_connect_failed`);
  }
});
