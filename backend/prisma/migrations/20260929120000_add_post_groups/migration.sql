-- Hand-written (not `migrate dev`): backfills every existing post into its own
-- one-target group before group_id becomes NOT NULL. websitePlan.md §10.2.

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('TEXT', 'IMAGE', 'CAROUSEL', 'VIDEO', 'STORY');

-- AlterEnum
ALTER TYPE "PostStatus" ADD VALUE 'CANCELLED';

-- CreateTable
CREATE TABLE "post_groups" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "content_kind" "ContentKind" NOT NULL,
    "caption" TEXT NOT NULL,
    "media_urls" JSONB NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'PROCESSING',
    "scheduled_for" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "group_id" TEXT;

-- Backfill: one group per existing post, reusing the post's id.
INSERT INTO "post_groups" ("id", "workspace_id", "created_by_user_id", "content_kind", "caption", "media_urls", "status", "scheduled_for", "idempotency_key", "created_at")
SELECT p."id", p."workspace_id", p."created_by_user_id",
  (CASE p."media_type"
    WHEN 'TEXT' THEN 'TEXT'
    WHEN 'IMAGE' THEN 'IMAGE'
    WHEN 'CAROUSEL' THEN 'CAROUSEL'
    WHEN 'STORIES' THEN 'STORY'
    ELSE 'VIDEO' -- VIDEO, REELS, SHORTS
  END)::"ContentKind",
  p."caption", p."media_urls", p."status", p."scheduled_for", 'legacy:' || p."id", p."created_at"
FROM "posts" p;

UPDATE "posts" SET "group_id" = "id";

ALTER TABLE "posts" ALTER COLUMN "group_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "post_groups_workspace_id_created_at_idx" ON "post_groups"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "post_groups_workspace_id_idempotency_key_key" ON "post_groups"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "posts_group_id_idx" ON "posts"("group_id");

-- AddForeignKey
ALTER TABLE "post_groups" ADD CONSTRAINT "post_groups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_groups" ADD CONSTRAINT "post_groups_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "post_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
