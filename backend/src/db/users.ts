import { env } from "../lib/env";
import { prisma } from "./client";

// No login yet (single-user mode) — every ConnectedAccount attaches to this
// one lazily-created row instead of requiring signup.
export async function getOrCreateDefaultUser() {
  return prisma.user.upsert({
    where: { email: env.DEFAULT_USER_EMAIL },
    update: {},
    create: { email: env.DEFAULT_USER_EMAIL, name: env.DEFAULT_USER_NAME },
  });
}
