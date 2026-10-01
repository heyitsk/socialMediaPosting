-- Hand-written from `migrate diff` (not `migrate dev`, which demands a reset
-- here because of a stale rolled-back migration row). Posting-limit slots and
-- account cooldowns, websitePlan.md §13.

-- CreateEnum
CREATE TYPE "CooldownReason" AS ENUM ('ABUSE_BLOCK', 'RATE_LIMIT', 'QUOTA');

-- CreateTable
CREATE TABLE "dispatch_slots" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "slot_at" TIMESTAMP(3) NOT NULL,
    "content_hash" TEXT NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_cooldowns" (
    "platform" "Platform" NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" "CooldownReason" NOT NULL,
    "message" TEXT NOT NULL,
    "source_post_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_cooldowns_pkey" PRIMARY KEY ("platform","platform_account_id")
);

-- CreateIndex
CREATE INDEX "dispatch_slots_platform_platform_account_id_slot_at_idx" ON "dispatch_slots"("platform", "platform_account_id", "slot_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_slots_post_id_attempt_platform_account_id_key" ON "dispatch_slots"("post_id", "attempt", "platform_account_id");

-- AddForeignKey
ALTER TABLE "dispatch_slots" ADD CONSTRAINT "dispatch_slots_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
