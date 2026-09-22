import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { getOrCreateDefaultUser } from "../db/users";

const connectedAccountSchema = z
  .object({
    id: z.string(),
    platform: z.enum(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST"]),
    accountName: z.string(),
    connectionMethod: z.enum(["FACEBOOK_PAGE", "INSTAGRAM_LOGIN", "THREADS_LOGIN"]),
    lastRefreshedAt: z.iso.datetime().nullable(),
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
      },
    });

    return c.json(
      accounts.map((account) => ({
        ...account,
        lastRefreshedAt: account.lastRefreshedAt?.toISOString() ?? null,
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
