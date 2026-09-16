/*
  Warnings:

  - Added the required column `connected_account_id` to the `posts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "connected_account_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
