-- Soft-delete marker for connected_accounts. "Disconnect" now sets this
-- instead of deleting the row, since posts.connected_account_id is RESTRICT
-- and a hard delete fails once the account has post history.
ALTER TABLE "connected_accounts" ADD COLUMN "disconnected_at" TIMESTAMP(3);
