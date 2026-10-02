-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "dispatched_at" TIMESTAMP(3);

-- Targets already in flight count as sent, so the reconciler fails them at
-- their deadline instead of sending them again.
UPDATE "posts" SET "dispatched_at" = "created_at" WHERE "status" = 'PROCESSING';
