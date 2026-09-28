import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "./client";

// OWNER isn't stored on the membership — it's Workspace.ownerUserId.
export type EffectiveRole = "OWNER" | WorkspaceRole;

// The one membership check everything goes through (requireWorkspace and the
// platform connect flows). A soft-deleted workspace counts as "not a member",
// which is what hides it — and its posts and accounts — everywhere at once.
export async function getRole(userId: string, workspaceId: string): Promise<EffectiveRole | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true, workspace: { select: { ownerUserId: true, deletedAt: true } } },
  });
  if (!membership || membership.workspace.deletedAt) {
    return null;
  }
  return membership.workspace.ownerUserId === userId ? "OWNER" : membership.role;
}

// Connecting/disconnecting platform accounts — websitePlan.md §9.7.
export function canManageAccounts(role: EffectiveRole | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}
