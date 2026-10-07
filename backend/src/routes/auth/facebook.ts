import { Hono } from "hono";
import { prisma } from "../../db/client";
import { beginConnect, connectRedirect, finishConnect } from "../../lib/connect-state";
import { encrypt } from "../../lib/crypto";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchInstagramBusinessAccount,
  fetchPages,
  fetchPermissions,
  fetchUserId,
} from "../../lib/facebook";
import { logger } from "../../lib/logger";

export const facebookAuthRoute = new Hono();

facebookAuthRoute.get("/", async (c) => {
  const started = await beginConnect(c, "facebook");
  if ("response" in started) return started.response;
  return c.redirect(buildAuthUrl(started.state));
});

facebookAuthRoute.get("/callback", async (c) => {
  const finished = await finishConnect(c, "facebook");
  if ("response" in finished) return finished.response;
  const { ctx } = finished;

  try {
    const shortLivedToken = await exchangeCodeForToken(ctx.code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await fetchPages(longLivedToken);
    const metaUserId = await fetchUserId(longLivedToken);
    logger.info(
      { platform: "facebook", pages: pages.length, metaUserId },
      "OAuth callback fetched pages",
    );

    // No Pages came back: none ticked in Facebook's dialog, none the person
    // can manage, or ones /me/accounts won't list. Saying "connected" here
    // would leave an empty dashboard and no clue why.
    if (pages.length === 0) {
      const permissions = await fetchPermissions(longLivedToken).catch(() => null);
      logger.warn({ platform: "facebook", metaUserId, permissions }, "Facebook granted no Pages");
      return c.redirect(connectRedirect("error=facebook_connect_no_pages", ctx.workspaceId));
    }

    for (const page of pages) {
      const encryptedPageToken = encrypt(page.access_token, 1);

      await prisma.connectedAccount.upsert({
        where: {
          workspaceId_platform_platformAccountId_connectionMethod: {
            workspaceId: ctx.workspaceId,
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
          metaUserId,
        },
        create: {
          workspaceId: ctx.workspaceId,
          platform: "FACEBOOK",
          platformAccountId: page.id,
          accountName: page.name,
          encryptedAccessToken: encryptedPageToken,
          keyVersion: 1,
          refreshStrategy: "NONE",
          lastRefreshedAt: new Date(),
          metaUserId,
        },
      });

      const instagramAccount = await fetchInstagramBusinessAccount(page.id, page.access_token);
      if (instagramAccount) {
        await prisma.connectedAccount.upsert({
          where: {
            workspaceId_platform_platformAccountId_connectionMethod: {
              workspaceId: ctx.workspaceId,
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
            metaUserId,
          },
          create: {
            workspaceId: ctx.workspaceId,
            platform: "INSTAGRAM",
            platformAccountId: instagramAccount.id,
            connectionMethod: "FACEBOOK_PAGE",
            accountName: instagramAccount.username,
            encryptedAccessToken: encryptedPageToken,
            keyVersion: 1,
            refreshStrategy: "NONE",
            lastRefreshedAt: new Date(),
            metaUserId,
          },
        });
      }
    }

    return c.redirect(connectRedirect("connected=facebook", ctx.workspaceId));
  } catch (err) {
    logger.error({ platform: "facebook", err }, "OAuth callback failed");
    return c.redirect(connectRedirect("error=facebook_connect_failed", ctx.workspaceId));
  }
});
