import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { type AuthEnv, requireAuth, requireRole, type WorkspaceEnv } from "../middleware/auth";
import { workspaceParamsSchema } from "./workspace-params";

// Owner/admin/member rules live in websitePlan.md §9.7.
export const workspaceRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]).openapi("WorkspaceRole");

export const workspaceSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: workspaceRoleSchema,
    isPersonal: z.boolean(),
  })
  .openapi("WorkspaceSummary");

const workspaceBodySchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .openapi("WorkspaceBody");

const createWorkspace = createRoute({
  method: "post",
  path: "/",
  tags: ["Workspaces"],
  summary: "Create a workspace — the caller becomes its owner",
  middleware: [requireAuth] as const,
  request: {
    body: { content: { "application/json": { schema: workspaceBodySchema } }, required: true },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: workspaceSummarySchema } },
    },
    401: { description: "Not signed in" },
  },
});

const renameWorkspace = createRoute({
  method: "patch",
  path: "/",
  tags: ["Workspaces"],
  summary: "Rename a workspace (owner only)",
  middleware: [requireRole("OWNER")] as const,
  request: {
    params: workspaceParamsSchema,
    body: { content: { "application/json": { schema: workspaceBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "Renamed",
      content: { "application/json": { schema: workspaceSummarySchema } },
    },
    403: { description: "Not the owner" },
  },
});

const deleteWorkspace = createRoute({
  method: "delete",
  path: "/",
  tags: ["Workspaces"],
  summary: "Delete a workspace (owner only, soft delete)",
  description:
    "Hides the workspace — with its posts and connected accounts — from every member and revokes pending invites. The rows are kept. A Personal workspace can't be deleted.",
  middleware: [requireRole("OWNER")] as const,
  request: { params: workspaceParamsSchema },
  responses: {
    204: { description: "Deleted" },
    403: { description: "Not the owner" },
    409: { description: "Personal workspaces can't be deleted" },
  },
});

const leaveWorkspace = createRoute({
  method: "post",
  path: "/leave",
  tags: ["Workspaces"],
  summary: "Leave a workspace (not allowed for the owner)",
  request: { params: workspaceParamsSchema },
  responses: {
    204: { description: "Left" },
    409: { description: "The owner can't leave" },
  },
});

// POST /api/workspaces — outside /api/workspaces/:workspaceId/*, so it
// checks the session itself.
export const workspacesRoute = new OpenAPIHono<AuthEnv>().openapi(createWorkspace, async (c) => {
  const { name } = c.req.valid("json");
  const workspace = await prisma.workspace.create({
    data: {
      name,
      ownerUserId: c.var.userId,
      memberships: { create: { userId: c.var.userId } },
    },
  });
  return c.json(
    { id: workspace.id, name: workspace.name, role: "OWNER" as const, isPersonal: false },
    201,
  );
});

// /api/workspaces/:workspaceId itself — requireAuth + requireWorkspace
// already ran (see index.ts).
export const workspaceRoute = new OpenAPIHono<WorkspaceEnv>()
  .openapi(renameWorkspace, async (c) => {
    const { name } = c.req.valid("json");
    const workspace = await prisma.workspace.update({
      where: { id: c.var.workspaceId },
      data: { name },
    });
    return c.json(
      {
        id: workspace.id,
        name: workspace.name,
        role: "OWNER" as const,
        isPersonal: workspace.isPersonal,
      },
      200,
    );
  })
  .openapi(deleteWorkspace, async (c) => {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: c.var.workspaceId },
      select: { isPersonal: true },
    });
    if (workspace.isPersonal) {
      throw new HTTPException(409, { message: "Your Personal workspace can't be deleted" });
    }

    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: c.var.workspaceId },
        data: { deletedAt: new Date() },
      }),
      prisma.workspaceInvite.deleteMany({
        where: { workspaceId: c.var.workspaceId, acceptedAt: null },
      }),
    ]);
    return c.body(null, 204);
  })
  .openapi(leaveWorkspace, async (c) => {
    if (c.var.role === "OWNER") {
      throw new HTTPException(409, { message: "The owner can't leave their workspace" });
    }
    await prisma.membership.delete({
      where: { userId_workspaceId: { userId: c.var.userId, workspaceId: c.var.workspaceId } },
    });
    return c.body(null, 204);
  });
