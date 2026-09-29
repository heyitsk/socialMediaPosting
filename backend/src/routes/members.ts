import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { requireRole, type WorkspaceEnv } from "../middleware/auth";
import { workspaceParamsSchema } from "./workspace-params";
import { workspaceRoleSchema } from "./workspaces";

const memberSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    avatarUrl: z.string().nullable(),
    role: workspaceRoleSchema,
    joinedAt: z.iso.datetime(),
  })
  .openapi("Member");

// The owner's role is fixed, so only these two can be assigned.
export const assignableRoleSchema = z.enum(["ADMIN", "MEMBER"]).openapi("AssignableRole");

const memberParamsSchema = workspaceParamsSchema.extend({ userId: z.string() });

const listMembers = createRoute({
  method: "get",
  path: "/",
  tags: ["Members"],
  summary: "List the workspace's members (owner only)",
  middleware: [requireRole("OWNER")] as const,
  request: { params: workspaceParamsSchema },
  responses: {
    200: {
      description: "Members, owner first",
      content: { "application/json": { schema: z.array(memberSchema) } },
    },
    403: { description: "Not the owner" },
  },
});

const changeRole = createRoute({
  method: "patch",
  path: "/{userId}",
  tags: ["Members"],
  summary: "Change a member's role (owner only)",
  middleware: [requireRole("OWNER")] as const,
  request: {
    params: memberParamsSchema,
    body: {
      content: { "application/json": { schema: z.object({ role: assignableRoleSchema }) } },
      required: true,
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: memberSchema } } },
    403: { description: "Not the owner" },
    404: { description: "Not a member" },
    409: { description: "The owner's role can't change" },
  },
});

const removeMember = createRoute({
  method: "delete",
  path: "/{userId}",
  tags: ["Members"],
  summary: "Remove a member (owner only)",
  description:
    "Takes effect on their next request. Accounts they connected and posts they made stay in the workspace.",
  middleware: [requireRole("OWNER")] as const,
  request: { params: memberParamsSchema },
  responses: {
    204: { description: "Removed" },
    403: { description: "Not the owner" },
    404: { description: "Not a member" },
    409: { description: "The owner can't be removed" },
  },
});

type MembershipWithUser = {
  role: "ADMIN" | "MEMBER";
  createdAt: Date;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
};

function toMember(m: MembershipWithUser, ownerUserId: string) {
  return {
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
    role: m.user.id === ownerUserId ? ("OWNER" as const) : m.role,
    joinedAt: m.createdAt.toISOString(),
  };
}

const userSelect = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;

// Every route here is owner-only, and the owner is always c.var.userId.
export const membersRoute = new OpenAPIHono<WorkspaceEnv>()
  .openapi(listMembers, async (c) => {
    const memberships = await prisma.membership.findMany({
      where: { workspaceId: c.var.workspaceId },
      include: { user: userSelect },
      orderBy: { createdAt: "asc" },
    });
    const members = memberships
      .map((m) => toMember(m, c.var.userId))
      .sort((a, b) => Number(b.role === "OWNER") - Number(a.role === "OWNER"));
    return c.json(members, 200);
  })
  .openapi(changeRole, async (c) => {
    const { userId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    if (userId === c.var.userId) {
      throw new HTTPException(409, { message: "The owner's role can't change" });
    }

    const where = { userId_workspaceId: { userId, workspaceId: c.var.workspaceId } };
    if (!(await prisma.membership.findUnique({ where, select: { id: true } }))) {
      throw new HTTPException(404, { message: "Member not found" });
    }
    const membership = await prisma.membership.update({
      where,
      data: { role },
      include: { user: userSelect },
    });
    return c.json(toMember(membership, c.var.userId), 200);
  })
  .openapi(removeMember, async (c) => {
    const { userId } = c.req.valid("param");
    if (userId === c.var.userId) {
      throw new HTTPException(409, { message: "The owner can't be removed" });
    }

    const { count } = await prisma.membership.deleteMany({
      where: { userId, workspaceId: c.var.workspaceId },
    });
    if (count === 0) {
      throw new HTTPException(404, { message: "Member not found" });
    }
    return c.body(null, 204);
  });
