-- AlterEnum
ALTER TYPE "ConnectionMethod" ADD VALUE 'YOUTUBE_LOGIN';

-- AlterEnum
ALTER TYPE "MediaType" ADD VALUE 'SHORTS';

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "platform_options" JSONB;
