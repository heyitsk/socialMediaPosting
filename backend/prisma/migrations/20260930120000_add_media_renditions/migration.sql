-- Hand-written (not `migrate dev`, which demands a reset here because of a
-- stale rolled-back migration row). Per-platform renditions of uploaded
-- media, websitePlan.md §12.

-- CreateEnum
CREATE TYPE "RenditionMode" AS ENUM ('CROP', 'PAD', 'CONVERT');

-- CreateEnum
CREATE TYPE "RenditionStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateTable
CREATE TABLE "media_renditions" (
    "id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "spec_hash" TEXT NOT NULL,
    "mode" "RenditionMode" NOT NULL,
    "crop_x" DOUBLE PRECISION,
    "crop_y" DOUBLE PRECISION,
    "crop_w" DOUBLE PRECISION,
    "crop_h" DOUBLE PRECISION,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "RenditionStatus" NOT NULL DEFAULT 'PENDING',
    "size_bytes" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "media_renditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media_renditions" (
    "post_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "rendition_id" TEXT NOT NULL,

    CONSTRAINT "post_media_renditions_pkey" PRIMARY KEY ("post_id","media_asset_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_renditions_key_key" ON "media_renditions"("key");

-- CreateIndex
CREATE INDEX "media_renditions_status_idx" ON "media_renditions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "media_renditions_media_asset_id_spec_hash_key" ON "media_renditions"("media_asset_id", "spec_hash");

-- CreateIndex
CREATE INDEX "post_media_renditions_rendition_id_idx" ON "post_media_renditions"("rendition_id");

-- AddForeignKey
ALTER TABLE "media_renditions" ADD CONSTRAINT "media_renditions_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media_renditions" ADD CONSTRAINT "post_media_renditions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media_renditions" ADD CONSTRAINT "post_media_renditions_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media_renditions" ADD CONSTRAINT "post_media_renditions_rendition_id_fkey" FOREIGN KEY ("rendition_id") REFERENCES "media_renditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

