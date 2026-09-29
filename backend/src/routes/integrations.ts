import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { reconnectReason } from "../lib/capabilities";
import { requireRole, type WorkspaceEnv } from "../middleware/auth";
import { workspaceParamsSchema } from "./workspace-params";

const connectedAccountSchema = z
  .object({
    id: z.string(),
    platform: z.enum(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST", "LINKEDIN"]),
    accountName: z.string(),
    connectionMethod: z.enum([
      "FACEBOOK_PAGE",
      "INSTAGRAM_LOGIN",
      "THREADS_LOGIN",
      "LINKEDIN_LOGIN",
      "YOUTUBE_LOGIN",
    ]),
    lastRefreshedAt: z.iso.datetime().nullable(),
    // See reconnectReason (lib/capabilities.ts) — surfaces the Reconnect
    // button before the user even tries to post.
    needsReconnect: z.boolean(),
  })
  .openapi("ConnectedAccountSummary");

const listIntegrations = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  summary: "List connected accounts",
  request: {
    params: workspaceParamsSchema,
  },
  responses: {
    200: {
      description: "Connected accounts in the workspace",
      content: { "application/json": { schema: z.array(connectedAccountSchema) } },
    },
  },
});

const disconnectIntegration = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Integrations"],
  summary: "Disconnect an account (owner or admin)",
  middleware: [requireRole("OWNER", "ADMIN")] as const,
  request: {
    params: workspaceParamsSchema.extend({ id: z.string() }),
  },
  responses: {
    204: { description: "Disconnected" },
    403: { description: "Members can't disconnect accounts" },
    404: { description: "Not found" },
  },
});

export const integrationsRoute = new OpenAPIHono<WorkspaceEnv>()
  .openapi(listIntegrations, async (c) => {
    const accounts = await prisma.connectedAccount.findMany({
      where: { workspaceId: c.var.workspaceId, disconnectedAt: null },
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
        needsReconnect: reconnectReason({ refreshStrategy, tokenExpiresAt, encryptedRefreshToken }) != null,
      })),
      200,
    );
  })
  .openapi(disconnectIntegration, async (c) => {
    const { id } = c.req.valid("param");

    // Soft-delete: posts.connected_account_id is RESTRICT, so a hard delete
    // fails once the account has post history. Reconnecting via OAuth
    // upserts the same row and clears disconnectedAt.
    const result = await prisma.connectedAccount.updateMany({
      where: { id, workspaceId: c.var.workspaceId, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
    });

    if (result.count === 0) {
      throw new HTTPException(404, { message: "Not found" });
    }
    return c.body(null, 204);
  });
