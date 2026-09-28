import { prisma } from "./client";

export async function isMember(userId: string, workspaceId: string): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  return membership !== null;
}
