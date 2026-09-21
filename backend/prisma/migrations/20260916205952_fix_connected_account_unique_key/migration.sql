-- Facebook-Page-linked and standalone-Instagram-Login flows can resolve to
-- the same platform_account_id for the same physical Instagram account, so
-- connection_method must be part of the uniqueness key or one flow's upsert
-- clobbers the other's stored token.
DROP INDEX "connected_accounts_user_id_platform_platform_account_id_key";

CREATE UNIQUE INDEX "connected_accounts_user_id_platform_platform_account_id_connection_method_key" ON "connected_accounts"("user_id", "platform", "platform_account_id", "connection_method");
