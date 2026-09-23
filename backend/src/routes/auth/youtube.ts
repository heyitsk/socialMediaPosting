import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getOrCreateDefaultUser } from "../../db/users";
import { prisma } from "../../db/client";
import { buildAuthUrl, exchangeCodeForToken, fetchChannel, UPLOAD_SCOPE } from "../../lib/youtube";
import { encrypt } from "../../lib/crypto";
import { env } from "../../lib/env";
import { redis } from "../../lib/redis";

const STATE_TTL_SECONDS = 300;

function stateKey(state: string): string {
  return `oauth:state:youtube:${state}`;
}

export const youtubeAuthRoute = new Hono();

youtubeAuthRoute.get("/", async (c) => {
  const state = randomBytes(16).toString("hex");
  await redis.set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);
  return c.redirect(buildAuthUrl(state));
});

youtubeAuthRoute.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const deniedError = c.req.query("error");

  if (deniedError || !code || !state) {
    return c.redirect(`${env.FRONTEND_URL}/?error=youtube_connect_denied`);
  }

  const key = stateKey(state);
  const validState = await redis.get(key);
  await redis.del(key);

  if (!validState) {
    return c.redirect(`${env.FRONTEND_URL}/?error=youtube_connect_invalid_state`);
  }

  try {
    const token = await exchangeCodeForToken(code);

    // Google's granular consent lets the user untick the upload checkbox and
    // still "Continue" — the connect would look successful but every post
    // would 403, so reject it here instead.
    if (!token.scope.split(" ").includes(UPLOAD_SCOPE)) {
      return c.redirect(`${env.FRONTEND_URL}/?error=youtube_connect_missing_scope`);
    }
    if (!token.refresh_token) {
      throw new Error("Google returned no refresh_token despite access_type=offline&prompt=consent");
    }

    const channel = await fetchChannel(token.access_token);
    if (!channel) {
      return c.redirect(`${env.FRONTEND_URL}/?error=youtube_connect_no_channel`);
    }

    const user = await getOrCreateDefaultUser();
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
        userId_platform_platformAccountId_connectionMethod: {
          userId: user.id,
          platform: "YOUTUBE",
          platformAccountId: channel.id,
          connectionMethod: "YOUTUBE_LOGIN",
        },
      },
      update: { ...tokenFields, disconnectedAt: null },
      create: {
        ...tokenFields,
        userId: user.id,
        platform: "YOUTUBE",
        platformAccountId: channel.id,
      },
    });

    return c.redirect(`${env.FRONTEND_URL}/?connected=youtube`);
  } catch (err) {
    console.error("YouTube OAuth callback failed:", err);
    return c.redirect(`${env.FRONTEND_URL}/?error=youtube_connect_failed`);
  }
});
