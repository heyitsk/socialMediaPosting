import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { requireRole, type WorkspaceEnv } from "../middleware/auth";
import { rateLimitByUser } from "../middleware/rate-limit";
import { assignableRoleSchema } from "./members";
import { workspaceParamsSchema } from "./workspace-params";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inviteSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: assignableRoleSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .openapi("Invite");

const listInvites = createRoute({
  method: "get",
  path: "/",
  tags: ["Invites"],
  summary: "List pending invites (owner only)",
  middleware: [requireRole("OWNER")] as const,
  request: { params: workspaceParamsSchema },
  responses: {
    200: {
      description: "Unaccepted, unexpired invites",
      content: { "application/json": { schema: z.array(inviteSchema) } },
    },
    403: { description: "Not the owner" },
  },
});

const createInvite = createRoute({
  method: "post",
  path: "/",
  tags: ["Invites"],
  summary: "Invite someone by email (owner only)",
  description:
    "If the email already has an smPosting account they're added at once (`added`). Otherwise the invite waits (`invited`, 7 days) and is accepted when they sign in with Google using that email. No email is sent — share the app link. Re-inviting refreshes the expiry and role. Limited to 20 per hour per user.",
  middleware: [requireRole("OWNER"), rateLimitByUser("invite", 20, 60 * 60)] as const,
  request: {
    params: workspaceParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ email: z.email(), role: assignableRoleSchema.default("MEMBER") })
            .openapi("InviteBody"),
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Added or invited",
      content: {
        "application/json": {
          schema: z
            .object({ status: z.enum(["added", "invited"]), invite: inviteSchema })
            .openapi("InviteResult"),
        },
      },
    },
    403: { description: "Not the owner" },
    409: { description: "Personal workspace, or already a member" },
    429: { description: "Too many invites" },
  },
});

const revokeInvite = createRoute({
  method: "delete",
  path: "/{inviteId}",
  tags: ["Invites"],
  summary: "Revoke a pending invite (owner only)",
  middleware: [requireRole("OWNER")] as const,
  request: { params: workspaceParamsSchema.extend({ inviteId: z.string() }) },
  responses: {
    204: { description: "Revoked" },
    403: { description: "Not the owner" },
    404: { description: "No such pending invite" },
  },
});

function toInvite(invite: {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  createdAt: Date;
  expiresAt: Date;
}) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export const invitesRoute = new OpenAPIHono<WorkspaceEnv>()
  .openapi(listInvites, async (c) => {
    const invites = await prisma.workspaceInvite.findMany({
      where: { workspaceId: c.var.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return c.json(invites.map(toInvite), 200);
  })
  .openapi(createInvite, async (c) => {
    const { role } = c.req.valid("json");
    const email = c.req.valid("json").email.trim().toLowerCase();
    const workspaceId = c.var.workspaceId;

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { isPersonal: true },
    });
    if (workspace.isPersonal) {
      throw new HTTPException(409, {
        message: "Personal workspaces are single-user — create a new workspace to invite people",
      });
    }

    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      const membership = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
        select: { id: true },
      });
      if (membership) {
        throw new HTTPException(409, { message: "Already a member of this workspace" });
      }
    }

    const now = new Date();
    const fields = {
      role,
      invitedByUserId: c.var.userId,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      // Already has an account → member right away, nothing left to accept.
      acceptedAt: existingUser ? now : null,
    };
    const invite = await prisma.$transaction(async (tx) => {
      if (existingUser) {
        await tx.membership.create({ data: { userId: existingUser.id, workspaceId, role } });
      }
      return tx.workspaceInvite.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        update: { ...fields, createdAt: now },
        create: { ...fields, workspaceId, email },
      });
    });

    return c.json({ status: existingUser ? "added" : "invited", invite: toInvite(invite) }, 201);
  })
  .openapi(revokeInvite, async (c) => {
    const { inviteId } = c.req.valid("param");
    const { count } = await prisma.workspaceInvite.deleteMany({
      where: { id: inviteId, workspaceId: c.var.workspaceId, acceptedAt: null },
    });
    if (count === 0) {
      throw new HTTPException(404, { message: "Invite not found" });
    }
    return c.body(null, 204);
  });
