import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { type EffectiveRole, getRole } from "../db/workspaces";
import { readSession } from "../lib/session";

export type AuthEnv = { Variables: { userId: string } };
export type WorkspaceEnv = {
  Variables: { userId: string; workspaceId: string; role: EffectiveRole };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = await readSession(c);
  if (!userId) {
    throw new HTTPException(401, { message: "Not signed in" });
  }
  c.set("userId", userId);
  await next();
});

// Tenant isolation for everything under /api/workspaces/:workspaceId. Runs
// after requireAuth. Non-members (and everyone, once the workspace is
// soft-deleted) get 404, not 403, so workspace ids can't be probed for
// existence. Every query below it must still filter by c.var.workspaceId —
// this only proves membership.
export const requireWorkspace = createMiddleware<WorkspaceEnv>(async (c, next) => {
  const workspaceId = c.req.param("workspaceId");
  const role = workspaceId ? await getRole(c.var.userId, workspaceId) : null;
  if (!workspaceId || !role) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }
  c.set("workspaceId", workspaceId);
  c.set("role", role);
  await next();
});

// Runs after requireWorkspace. 403, not 404 — the caller is already a member,
// so there's nothing left to hide.
export function requireRole(...allowed: EffectiveRole[]) {
  return createMiddleware<WorkspaceEnv>(async (c, next) => {
    if (!allowed.includes(c.var.role)) {
      throw new HTTPException(403, { message: "Your role in this workspace can't do that" });
    }
    await next();
  });
}
