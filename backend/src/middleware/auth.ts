import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { isMember } from "../db/workspaces";
import { readSession } from "../lib/session";

export type AuthEnv = { Variables: { userId: string } };
export type WorkspaceEnv = { Variables: { userId: string; workspaceId: string } };

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const userId = await readSession(c);
  if (!userId) {
    throw new HTTPException(401, { message: "Not signed in" });
  }
  c.set("userId", userId);
  await next();
});

// Tenant isolation for everything under /api/workspaces/:workspaceId/*. Runs
// after requireAuth. Non-members get 404, not 403, so workspace ids can't be
// probed for existence. Every query below it must still filter by
// c.var.workspaceId — this only proves membership.
export const requireWorkspace = createMiddleware<WorkspaceEnv>(async (c, next) => {
  const workspaceId = c.req.param("workspaceId");
  if (!workspaceId || !(await isMember(c.var.userId, workspaceId))) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }
  c.set("workspaceId", workspaceId);
  await next();
});
