import { describe, expect, test } from "bun:test";
import { classifyLimitError } from "./limit-errors";

// Shaped like what n8n's HTTP Request node reports: status, the response body
// as a JSON-encoded string, then the node.
const n8n = (status: number, body: object, node = "Publish") =>
  `${status} - ${JSON.stringify(JSON.stringify(body))} (node: ${node})`;

const metaError = (code: number, subcode?: number) =>
  n8n(400, {
    error: { message: "x", type: "OAuthException", code, error_subcode: subcode },
  });

describe("classifyLimitError", () => {
  test("Meta spam block (368) pauses the account for 24 h", () => {
    const result = classifyLimitError(metaError(368, 1390008), "FACEBOOK");
    expect(result).toEqual({
      reason: "ABUSE_BLOCK",
      appWide: false,
      length: { kind: "FOR", ms: 24 * 60 * 60_000 },
      message: "Meta flagged the posting as spam",
    });
    expect(classifyLimitError(metaError(368), "INSTAGRAM")?.reason).toBe("ABUSE_BLOCK");
    // Unescaped JSON too.
    expect(classifyLimitError('400 - {"error":{"code":368}}', "THREADS")?.reason).toBe(
      "ABUSE_BLOCK",
    );
  });

  test("Instagram's publishing limit waits out the rolling 24 h", () => {
    const result = classifyLimitError(metaError(9, 2207042), "INSTAGRAM");
    expect(result?.reason).toBe("QUOTA");
    expect(result?.length).toEqual({ kind: "ROLLING_24H" });
  });

  test("Graph API throttling codes pause for an hour", () => {
    for (const code of [4, 17, 32, 613, 80001]) {
      const result = classifyLimitError(metaError(code), "FACEBOOK");
      expect(result?.reason).toBe("RATE_LIMIT");
      expect(result?.length).toEqual({ kind: "FOR", ms: 60 * 60_000 });
    }
  });

  test("codes that only look similar don't match", () => {
    expect(classifyLimitError(metaError(190), "FACEBOOK")).toBeNull();
    expect(classifyLimitError(metaError(400), "FACEBOOK")).toBeNull();
    expect(classifyLimitError(metaError(100, 4), "FACEBOOK")).toBeNull(); // subcode 4
    expect(classifyLimitError(metaError(40), "FACEBOOK")).toBeNull();
    // Meta codes mean nothing on other platforms.
    expect(classifyLimitError(metaError(368), "LINKEDIN")).toBeNull();
  });

  test("YouTube: project quota is app-wide until Pacific midnight, channel limit isn't", () => {
    const quota = classifyLimitError(
      n8n(403, { error: { errors: [{ reason: "quotaExceeded" }] } }),
      "YOUTUBE",
    );
    expect(quota?.appWide).toBe(true);
    expect(quota?.length).toEqual({ kind: "NEXT_DAY", window: "PACIFIC_DAY" });

    const channel = classifyLimitError(
      n8n(400, { error: { errors: [{ reason: "uploadLimitExceeded" }] } }),
      "YOUTUBE",
    );
    expect(channel?.appWide).toBe(false);
    expect(channel?.reason).toBe("QUOTA");

    // The poller's own error text.
    const poller = classifyLimitError(
      'YouTube video status fetch failed (403): {"error":{"errors":[{"reason":"quotaExceeded"}]}}',
      "YOUTUBE",
    );
    expect(poller?.appWide).toBe(true);
  });

  test("LinkedIn 429 waits for UTC midnight; other 429s an hour", () => {
    expect(classifyLimitError(n8n(429, { message: "Too many" }), "LINKEDIN")?.length).toEqual({
      kind: "NEXT_DAY",
      window: "UTC_DAY",
    });
    expect(classifyLimitError(n8n(429, { message: "Too many" }), "THREADS")?.length).toEqual({
      kind: "FOR",
      ms: 60 * 60_000,
    });
  });

  test("ordinary failures aren't limits", () => {
    expect(classifyLimitError(n8n(500, { message: "oops" }), "FACEBOOK")).toBeNull();
    expect(classifyLimitError("The account was disconnected", "INSTAGRAM")).toBeNull();
    expect(classifyLimitError(n8n(400, { message: "Invalid image" }), "LINKEDIN")).toBeNull();
  });
});
