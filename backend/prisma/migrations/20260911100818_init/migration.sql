-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'THREADS', 'YOUTUBE', 'PINTEREST');

-- CreateEnum
CREATE TYPE "RefreshStrategy" AS ENUM ('NONE', 'SLIDING_WINDOW', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'CAROUSEL');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PROCESSING', 'PUBLISHED', 'PARTIAL_FAILURE', 'FAILED');

-- CreateEnum
CREATE TYPE "PostLogStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "account_name" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "encrypted_refresh_token" TEXT,
    "key_version" INTEGER NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "refresh_strategy" "RefreshStrategy" NOT NULL,
    "last_refreshed_at" TIMESTAMP(3),

    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "media_type" "MediaType" NOT NULL,
    "media_urls" JSONB NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_logs" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "PostLogStatus" NOT NULL,
    "platform_post_id" TEXT,
    "error_message" TEXT,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_user_id_platform_platform_account_id_key" ON "connected_accounts"("user_id", "platform", "platform_account_id");

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_logs" ADD CONSTRAINT "post_logs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
