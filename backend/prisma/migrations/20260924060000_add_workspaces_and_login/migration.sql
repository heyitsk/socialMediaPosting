-- Hand-written (not `migrate dev`): the generated diff drops posts.user_id /
-- connected_accounts.user_id and adds NOT NULL workspace_id with no backfill,
-- which fails on existing rows. Here every existing user gets a "Personal"
-- workspace and their rows are moved into it before the old columns go.
-- See websitePlan.md §9.3.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "google_sub" TEXT,
ADD COLUMN     "last_login_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- Backfill: one Personal workspace + owner membership per existing user.
INSERT INTO "workspaces" ("id", "name", "owner_user_id")
SELECT gen_random_uuid()::text, 'Personal', "id" FROM "users";

INSERT INTO "memberships" ("id", "user_id", "workspace_id")
SELECT gen_random_uuid()::text, "owner_user_id", "id" FROM "workspaces";

-- connected_accounts: user_id -> workspace_id
ALTER TABLE "connected_accounts" DROP CONSTRAINT "connected_accounts_user_id_fkey";
DROP INDEX "connected_accounts_user_id_platform_platform_account_id_connect";

ALTER TABLE "connected_accounts" ADD COLUMN "workspace_id" TEXT;
UPDATE "connected_accounts" c SET "workspace_id" = w."id"
FROM "workspaces" w WHERE w."owner_user_id" = c."user_id";
ALTER TABLE "connected_accounts" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "connected_accounts" DROP COLUMN "user_id";

-- posts: user_id -> workspace_id + created_by_user_id
ALTER TABLE "posts" DROP CONSTRAINT "posts_user_id_fkey";

ALTER TABLE "posts" ADD COLUMN "workspace_id" TEXT,
ADD COLUMN "created_by_user_id" TEXT;
UPDATE "posts" p SET "workspace_id" = w."id", "created_by_user_id" = p."user_id"
FROM "workspaces" w WHERE w."owner_user_id" = p."user_id";
ALTER TABLE "posts" ALTER COLUMN "workspace_id" SET NOT NULL,
ALTER COLUMN "created_by_user_id" SET NOT NULL;
ALTER TABLE "posts" DROP COLUMN "user_id";

-- CreateIndex
CREATE INDEX "memberships_workspace_id_idx" ON "memberships"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_workspace_id_key" ON "memberships"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "workspace_invites_email_idx" ON "workspace_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_workspace_id_email_key" ON "workspace_invites"("workspace_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "connected_accounts_workspace_id_platform_platform_account_i_key" ON "connected_accounts"("workspace_id", "platform", "platform_account_id", "connection_method");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
