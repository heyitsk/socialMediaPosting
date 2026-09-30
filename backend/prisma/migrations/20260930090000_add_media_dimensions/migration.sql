-- Hand-written (not `migrate dev`, which demands a reset here because of a
-- stale rolled-back migration row). Media dimensions for per-platform
-- fitting, websitePlan.md §12.3.

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "duration_seconds" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;
