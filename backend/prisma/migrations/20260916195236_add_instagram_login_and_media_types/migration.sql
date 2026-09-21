-- CreateEnum
CREATE TYPE "ConnectionMethod" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM_LOGIN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaType" ADD VALUE 'REELS';
ALTER TYPE "MediaType" ADD VALUE 'STORIES';

-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "connection_method" "ConnectionMethod" NOT NULL DEFAULT 'FACEBOOK_PAGE';
