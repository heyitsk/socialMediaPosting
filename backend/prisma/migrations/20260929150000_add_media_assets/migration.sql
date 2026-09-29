-- Hand-written (not `migrate dev`, which demands a reset here because of a
-- stale rolled-back migration row). S3 media uploads, websitePlan.md §11.

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'READY', 'DELETED');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "group_id" TEXT,
    "position" INTEGER,
    "key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "multipart_upload_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_key_key" ON "media_assets"("key");

-- CreateIndex
CREATE INDEX "media_assets_group_id_idx" ON "media_assets"("group_id");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "media_assets"("status", "created_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "post_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
