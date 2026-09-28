import type { GoogleIdentity } from "../lib/google-login";
import { prisma } from "./client";

// Called on every successful Google sign-in. Matches on Google's `sub`, never
// on email alone — the one exception is linking a pre-login row that has no
// googleSub yet (the pre-login seeded user). websitePlan.md §9.4.
export async function upsertUserFromGoogle(identity: GoogleIdentity) {
  const profile = { name: identity.name, avatarUrl: identity.avatarUrl, lastLoginAt: new Date() };

  return prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { googleSub: identity.sub } });

    if (user) {
      user = await tx.user.update({
        where: { id: user.id },
        data: { ...profile, email: identity.email },
      });
    } else {
      const unlinked = await tx.user.findFirst({
        where: { email: identity.email, googleSub: null },
      });
      user = unlinked
        ? await tx.user.update({
            where: { id: unlinked.id },
            data: { ...profile, googleSub: identity.sub },
          })
        : await tx.user.create({
            data: { ...profile, email: identity.email, googleSub: identity.sub },
          });
    }

    // Every user always has at least one workspace — a brand-new signup (or
    // a linked row that somehow has none) gets a Personal one.
    const membershipCount = await tx.membership.count({ where: { userId: user.id } });
    if (membershipCount === 0) {
      await tx.workspace.create({
        data: {
          name: "Personal",
          ownerUserId: user.id,
          memberships: { create: { userId: user.id } },
        },
      });
    }

    const invites = await tx.workspaceInvite.findMany({
      where: { email: identity.email, acceptedAt: null, expiresAt: { gt: new Date() } },
    });
    for (const invite of invites) {
      await tx.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
        update: {},
        create: { userId: user.id, workspaceId: invite.workspaceId },
      });
      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    }

    return user;
  });
}
