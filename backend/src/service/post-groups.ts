import type { Platform, PostStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/client";

type Tx = Prisma.TransactionClient;

// Every change to a target's status goes through here, so the group's
// aggregated status can't drift from its targets'. websitePlan.md §10.4.

// Takes the group row lock first: two platforms' callbacks can land in the
// same millisecond, and without it each transaction would read the other
// target as still PROCESSING and both would write PROCESSING.
async function lockGroup(tx: Tx, groupId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM post_groups WHERE id = ${groupId} FOR UPDATE`;
}

export function aggregateStatus(statuses: PostStatus[]): PostStatus {
  if (statuses.includes("SCHEDULED")) return "SCHEDULED";
  if (statuses.includes("PROCESSING")) return "PROCESSING";
  // Cancelling only reaches targets that hadn't been sent yet, so a mix means
  // some went out first — judge the group by those.
  const sent = statuses.filter((status) => status !== "CANCELLED");
  if (sent.length === 0) return "CANCELLED";
  if (sent.every((status) => status === "PUBLISHED")) return "PUBLISHED";
  if (sent.every((status) => status === "FAILED")) return "FAILED";
  return "PARTIAL_FAILURE";
}

async function recomputeGroupStatus(tx: Tx, groupId: string): Promise<void> {
  const targets = await tx.post.findMany({ where: { groupId }, select: { status: true } });
  await tx.postGroup.update({
    where: { id: groupId },
    data: { status: aggregateStatus(targets.map((target) => target.status)) },
  });
}

// Moves one target to a new status (and logs the outcome, for final ones)
// under the group lock. `apply` sees the target's current state and returns
// false to skip — that's how duplicate callbacks, stale deadline jobs and
// cancelled targets become no-ops. Returns whether it applied.
async function transitionTarget(
  postId: string,
  apply: (post: { status: PostStatus; attempt: number }) => boolean,
  next: PostStatus,
  log?: {
    platform: Platform;
    status: "SUCCESS" | "FAILED";
    platformPostId?: string | null;
    errorMessage?: string | null;
  },
): Promise<boolean> {
  const target = await prisma.post.findUnique({ where: { id: postId }, select: { groupId: true } });
  if (!target) return false;

  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, target.groupId);
    const post = await tx.post.findUniqueOrThrow({
      where: { id: postId },
      select: { status: true, attempt: true },
    });
    if (!apply(post)) return false;

    if (log) {
      await tx.postLog.create({
        data: {
          postId,
          platform: log.platform,
          status: log.status,
          platformPostId: log.platformPostId ?? null,
          errorMessage: log.errorMessage ?? null,
        },
      });
    }
    await tx.post.update({ where: { id: postId }, data: { status: next } });
    await recomputeGroupStatus(tx, target.groupId);
    return true;
  });
}

export function markTargetProcessing(postId: string, attempt: number): Promise<boolean> {
  return transitionTarget(
    postId,
    (post) => post.status === "SCHEDULED" && post.attempt === attempt,
    "PROCESSING",
  );
}

// A SUCCESS always wins over anything but an existing PUBLISHED — including
// a FAILED written by the callback-deadline job, since a late callback means
// the post really did go out. A duplicate SUCCESS callback is a no-op.
export function markTargetPublished(
  postId: string,
  platform: Platform,
  platformPostId: string | null,
): Promise<boolean> {
  return transitionTarget(postId, (post) => post.status !== "PUBLISHED", "PUBLISHED", {
    platform,
    status: "SUCCESS",
    platformPostId,
  });
}

// Only a target still in flight can fail. `attempt`, when given, must match —
// it's how a deadline job from before a manual retry leaves the retry alone.
// (n8n callbacks carry no attempt, so a very late FAILED callback from an
// earlier attempt can still fail a retry that's in flight — rare enough to
// accept rather than change every workflow's callback payload.)
export function markTargetFailed(
  postId: string,
  platform: Platform,
  errorMessage: string,
  options: { attempt?: number; platformPostId?: string | null } = {},
): Promise<boolean> {
  return transitionTarget(
    postId,
    (post) =>
      (post.status === "PROCESSING" || post.status === "SCHEDULED") &&
      (options.attempt === undefined || post.attempt === options.attempt),
    "FAILED",
    { platform, status: "FAILED", errorMessage, platformPostId: options.platformPostId },
  );
}

export function markTargetCancelled(postId: string): Promise<boolean> {
  return transitionTarget(postId, (post) => post.status === "SCHEDULED", "CANCELLED");
}

// Manual retry (decision 4 in websitePlan.md §10.1): FAILED targets only. The
// old PostLog rows stay as attempt history. Returns the new attempt number,
// or null if the target wasn't in a retryable state.
export async function prepareRetry(postId: string): Promise<number | null> {
  const target = await prisma.post.findUnique({ where: { id: postId }, select: { groupId: true } });
  if (!target) return null;

  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, target.groupId);
    const post = await tx.post.findUniqueOrThrow({
      where: { id: postId },
      select: { status: true, attempt: true },
    });
    if (post.status !== "FAILED") return null;

    const updated = await tx.post.update({
      where: { id: postId },
      data: { status: "PROCESSING", attempt: post.attempt + 1 },
      select: { attempt: true },
    });
    await recomputeGroupStatus(tx, target.groupId);
    return updated.attempt;
  });
}
