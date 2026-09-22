import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getOrCreateDefaultUser } from "../../db/users";
import { prisma } from "../../db/client";
import { buildAuthUrl, exchangeCodeForToken, fetchProfile } from "../../lib/linkedin";
import { encrypt } from "../../lib/crypto";
import { env } from "../../lib/env";
import { redis } from "../../lib/redis";

const STATE_TTL_SECONDS = 300;

function stateKey(state: string): string {
  return `oauth:state:linkedin:${state}`;
}

export const linkedinAuthRoute = new Hono();

linkedinAuthRoute.get("/", async (c) => {
  const state = randomBytes(16).toString("hex");
  await redis.set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);
  return c.redirect(buildAuthUrl(state));
});

linkedinAuthRoute.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const deniedError = c.req.query("error");

  if (deniedError || !code || !state) {
    return c.redirect(`${env.FRONTEND_URL}/?error=linkedin_connect_denied`);
  }

  const key = stateKey(state);
  const validState = await redis.get(key);
  await redis.del(key);

  if (!validState) {
    return c.redirect(`${env.FRONTEND_URL}/?error=linkedin_connect_invalid_state`);
  }

  try {
    const token = await exchangeCodeForToken(code);
    const profile = await fetchProfile(token.access_token);
    const user = await getOrCreateDefaultUser();

    await prisma.connectedAccount.upsert({
      where: {
        userId_platform_platformAccountId_connectionMethod: {
          userId: user.id,
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
        userId: user.id,
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

    return c.redirect(`${env.FRONTEND_URL}/?connected=linkedin`);
  } catch (err) {
    console.error("LinkedIn OAuth callback failed:", err);
    return c.redirect(`${env.FRONTEND_URL}/?error=linkedin_connect_failed`);
  }
});
