// What "disconnected" means for a connected account's row. The row stays (posts
// reference it, and posts.connected_account_id is RESTRICT), but the tokens are
// wiped — we hold no way to post as the user once they've disconnected or
// Meta says they've removed the app. encryptedAccessToken is NOT NULL, hence
// the empty string; decrypt() is never reached for these rows because every
// reader checks disconnectedAt first.
export function disconnectedAccountData() {
  return {
    disconnectedAt: new Date(),
    encryptedAccessToken: "",
    encryptedRefreshToken: null,
    tokenExpiresAt: null,
    metaUserId: null,
  };
}
