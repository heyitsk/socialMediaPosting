import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { destroyAllSessions, destroySession } from "../lib/session";
import { type AuthEnv, requireAuth } from "../middleware/auth";
import { workspaceSummarySchema } from "./workspaces";

const meSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    createdAt: z.string(),
    workspaces: z.array(workspaceSummarySchema),
  })
  .openapi("Me");

const getMe = createRoute({
  method: "get",
  path: "/me",
  tags: ["Session"],
  summary: "The signed-in user and the workspaces they belong to",
  middleware: [requireAuth] as const,
  responses: {
    200: { description: "Signed in", content: { "application/json": { schema: meSchema } } },
    401: { description: "Not signed in" },
  },
});

const logout = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Session"],
  summary: "End this browser's session",
  responses: {
    204: { description: "Signed out" },
  },
});

const logoutAll = createRoute({
  method: "post",
  path: "/logout-all",
  tags: ["Session"],
  summary: "End every session of the signed-in user, on all devices",
  middleware: [requireAuth] as const,
  responses: {
    204: { description: "Signed out everywhere" },
    401: { description: "Not signed in" },
  },
});

export const sessionRoute = new OpenAPIHono<AuthEnv>()
  .openapi(getMe, async (c) => {
    const user = await prisma.user.findUnique({
      where: { id: c.var.userId },
      include: {
        memberships: {
          where: { workspace: { deletedAt: null } },
          include: { workspace: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    // Session outlived its user (e.g. deleted) — treat as signed out.
    if (!user) {
      throw new HTTPException(401, { message: "Not signed in" });
    }

    return c.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt.toISOString(),
        workspaces: user.memberships.map(({ workspace, role }) => ({
          id: workspace.id,
          name: workspace.name,
          role: workspace.ownerUserId === user.id ? ("OWNER" as const) : role,
          isPersonal: workspace.isPersonal,
        })),
      },
      200,
    );
  })
  .openapi(logout, async (c) => {
    await destroySession(c);
    return c.body(null, 204);
  })
  .openapi(logoutAll, async (c) => {
    await destroyAllSessions(c.var.userId);
    await destroySession(c);
    return c.body(null, 204);
  });
