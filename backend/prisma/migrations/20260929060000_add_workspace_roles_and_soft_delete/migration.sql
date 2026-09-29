-- Hand-written (not `migrate dev`): adds the Personal backfill and a partial
-- unique index, which the generated diff can't express. See websitePlan.md §9.7.

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "workspace_invites" ADD COLUMN     "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_personal" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: each user's oldest owned workspace is the auto-created Personal one.
UPDATE "workspaces" w SET "is_personal" = true
WHERE w."id" = (
  SELECT w2."id" FROM "workspaces" w2
  WHERE w2."owner_user_id" = w."owner_user_id"
  ORDER BY w2."created_at" ASC, w2."id" ASC
  LIMIT 1
);

-- At most one Personal workspace per user (Prisma can't model partial indexes).
CREATE UNIQUE INDEX "workspaces_one_personal_per_owner" ON "workspaces"("owner_user_id") WHERE "is_personal";
