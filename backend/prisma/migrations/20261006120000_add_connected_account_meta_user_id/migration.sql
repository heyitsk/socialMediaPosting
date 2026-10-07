-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "meta_user_id" TEXT;

-- CreateIndex
CREATE INDEX "connected_accounts_meta_user_id_idx" ON "connected_accounts"("meta_user_id");
