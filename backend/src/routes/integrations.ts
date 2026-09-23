import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { getOrCreateDefaultUser } from "../db/users";
import { TOKEN_EXPIRY_BUFFER_MS } from "../service/n8n";

const connectedAccountSchema = z
  .object({
    id: z.string(),
    platform: z.enum(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST", "LINKEDIN"]),
    accountName: z.string(),
    connectionMethod: z.enum(["FACEBOOK_PAGE", "INSTAGRAM_LOGIN", "THREADS_LOGIN", "LINKEDIN_LOGIN", "YOUTUBE_LOGIN"]),
    lastRefreshedAt: z.iso.datetime().nullable(),
    // True once a REQUIRES_RECONNECT/SLIDING_WINDOW account's token is inside
    // (or past) TOKEN_EXPIRY_BUFFER_MS of expiring — LinkedIn issues no
    // refresh token at all, so this is the only way back short of the member
    // redoing the OAuth consent screen (see service/n8n.ts's dispatch-time
    // check, which throws the same condition — this just surfaces it in the
    // UI before the user even tries to post). For ON_DEMAND (YouTube) the
    // access token's own expiry is irrelevant — it's refreshed on use — so
    // the signal is instead a refresh token Google rejected and
    // service/youtube-token.ts cleared.
    needsReconnect: z.boolean(),
  })
  .openapi("ConnectedAccountSummary");

const listIntegrations = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  summary: "List connected accounts",
  responses: {
    200: {
      description: "Connected accounts for the current user",
      content: { "application/json": { schema: z.array(connectedAccountSchema) } },
    },
  },
});

const disconnectIntegration = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Integrations"],
  summary: "Disconnect an account",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: "Disconnected" },
    404: { description: "Not found" },
  },
});

export const integrationsRoute = new OpenAPIHono()
  .openapi(listIntegrations, async (c) => {
    const user = await getOrCreateDefaultUser();
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: user.id, disconnectedAt: null },
      select: {
        id: true,
        platform: true,
        accountName: true,
        connectionMethod: true,
        lastRefreshedAt: true,
        refreshStrategy: true,
        tokenExpiresAt: true,
        encryptedRefreshToken: true,
      },
    });

    return c.json(
      accounts.map(({ refreshStrategy, tokenExpiresAt, encryptedRefreshToken, ...account }) => ({
        ...account,
        lastRefreshedAt: account.lastRefreshedAt?.toISOString() ?? null,
        needsReconnect:
          refreshStrategy === "ON_DEMAND"
            ? encryptedRefreshToken == null
            : (refreshStrategy === "REQUIRES_RECONNECT" || refreshStrategy === "SLIDING_WINDOW") &&
              tokenExpiresAt != null &&
              tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now(),
      })),
      200,
    );
  })
  .openapi(disconnectIntegration, async (c) => {
    const { id } = c.req.valid("param");
    const user = await getOrCreateDefaultUser();

    // Soft-delete: posts.connected_account_id is RESTRICT, so a hard delete
    // fails once the account has post history. Reconnecting via OAuth
    // upserts the same row and clears disconnectedAt.
    const result = await prisma.connectedAccount.updateMany({
      where: { id, userId: user.id, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
    });

    if (result.count === 0) {
      throw new HTTPException(404, { message: "Not found" });
    }
    return c.body(null, 204);
  });
