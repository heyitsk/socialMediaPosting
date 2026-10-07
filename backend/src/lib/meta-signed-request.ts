import { createHmac, timingSafeEqual } from "node:crypto";

// Meta's deauthorize and data-deletion callbacks POST one form field,
// `signed_request`: "<signature>.<payload>", both base64url. The signature is
// HMAC-SHA256 over the still-encoded payload, keyed with the app secret; the
// payload is JSON with the app-scoped `user_id`.
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
//
// Returns the user id, or null for anything that isn't a correctly signed
// request — the caller answers 400 and never reveals which check failed.
export function parseSignedRequest(signedRequest: string, appSecret: string): string | null {
  const parts = signedRequest.split(".");
  if (parts.length !== 2) return null;
  const [encodedSignature, encodedPayload] = parts as [string, string];

  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      algorithm?: unknown;
      user_id?: unknown;
    };
    // Only HMAC-SHA256 is ever issued; an "algorithm" of anything else is not Meta.
    if (typeof payload.algorithm === "string" && payload.algorithm.toUpperCase() !== "HMAC-SHA256")
      return null;
    if (typeof payload.user_id !== "string" && typeof payload.user_id !== "number") return null;
    const userId = String(payload.user_id);
    return userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}
