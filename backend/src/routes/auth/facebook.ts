import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getOrCreateDefaultUser } from "../../db/users";
import { prisma } from "../../db/client";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchInstagramBusinessAccount,
  fetchPages,
} from "../../lib/facebook";
import { encrypt } from "../../lib/crypto";
import { env } from "../../lib/env";
import { redis } from "../../lib/redis";

const STATE_TTL_SECONDS = 300;

function stateKey(state: string): string {
  return `oauth:state:facebook:${state}`;
}

export const facebookAuthRoute = new Hono();

facebookAuthRoute.get("/", async (c) => {
  const state = randomBytes(16).toString("hex");
  await redis.set(stateKey(state), "1", "EX", STATE_TTL_SECONDS);
  return c.redirect(buildAuthUrl(state));
});

facebookAuthRoute.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const deniedError = c.req.query("error");

  if (deniedError || !code || !state) {
    return c.redirect(`${env.FRONTEND_URL}/?error=facebook_connect_denied`);
  }

  const key = stateKey(state);
  const validState = await redis.get(key);
  await redis.del(key);

  if (!validState) {
    return c.redirect(`${env.FRONTEND_URL}/?error=facebook_connect_invalid_state`);
  }

  try {
    const shortLivedToken = await exchangeCodeForToken(code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await fetchPages(longLivedToken);
    const user = await getOrCreateDefaultUser();

    for (const page of pages) {
      const encryptedPageToken = encrypt(page.access_token, 1);

      await prisma.connectedAccount.upsert({
        where: {
          userId_platform_platformAccountId_connectionMethod: {
            userId: user.id,
            platform: "FACEBOOK",
            platformAccountId: page.id,
            connectionMethod: "FACEBOOK_PAGE",
          },
        },
        update: {
          accountName: page.name,
          encryptedAccessToken: encryptedPageToken,
          keyVersion: 1,
          lastRefreshedAt: new Date(),
          disconnectedAt: null,
        },
        create: {
          userId: user.id,
          platform: "FACEBOOK",
          platformAccountId: page.id,
          accountName: page.name,
          encryptedAccessToken: encryptedPageToken,
          keyVersion: 1,
          refreshStrategy: "NONE",
          lastRefreshedAt: new Date(),
        },
      });

      const instagramAccount = await fetchInstagramBusinessAccount(page.id, page.access_token);
      if (instagramAccount) {
        await prisma.connectedAccount.upsert({
          where: {
            userId_platform_platformAccountId_connectionMethod: {
              userId: user.id,
              platform: "INSTAGRAM",
              platformAccountId: instagramAccount.id,
              connectionMethod: "FACEBOOK_PAGE",
            },
          },
          update: {
            accountName: instagramAccount.username,
            encryptedAccessToken: encryptedPageToken,
            keyVersion: 1,
            lastRefreshedAt: new Date(),
            disconnectedAt: null,
          },
          create: {
            userId: user.id,
            platform: "INSTAGRAM",
            platformAccountId: instagramAccount.id,
            connectionMethod: "FACEBOOK_PAGE",
            accountName: instagramAccount.username,
            encryptedAccessToken: encryptedPageToken,
            keyVersion: 1,
            refreshStrategy: "NONE",
            lastRefreshedAt: new Date(),
          },
        });
      }
    }

    return c.redirect(`${env.FRONTEND_URL}/?connected=facebook`);
  } catch (err) {
    console.error("Facebook OAuth callback failed:", err);
    return c.redirect(`${env.FRONTEND_URL}/?error=facebook_connect_failed`);
  }
});
