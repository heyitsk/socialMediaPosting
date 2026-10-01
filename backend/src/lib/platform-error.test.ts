import { describe, expect, test } from "bun:test";
import { friendlyPlatformError } from "./platform-error";

// The shapes the video relay Code nodes produce once they reach
// Build Error Result (websitePlan.md §15): n8n adds " [line N]" to a thrown
// error, and the Build Error Result node adds the node name.
describe("video relay errors", () => {
  test("a platform's JSON body is still read", () => {
    const raw =
      '400 - {"message":"Invalid upload url","status":400} [line 35] (node: LI Relay Video Parts)';
    expect(friendlyPlatformError(raw, "LINKEDIN")).toBe("Invalid upload url");
  });

  test("status rules still match", () => {
    const raw = "401 - {} [line 35] (node: YT Relay Video)";
    expect(friendlyPlatformError(raw, "YOUTUBE")).toBe(
      "The platform didn't accept this account's login — reconnect it on the Dashboard.",
    );
  });

  test("a missing S3 object reads as removed media", () => {
    const raw =
      "Reading the media file failed: 404 - <Error><Code>NoSuchKey</Code></Error> [line 72] (node: LI Relay Video Parts)";
    expect(friendlyPlatformError(raw, "LINKEDIN")).toBe(
      "Couldn't read the media file — it may have been removed (uploads are kept 15 days). Create the post again.",
    );
  });

  test("other S3 read failures ask to try again", () => {
    const raw =
      "Reading the media file failed: got 10 bytes for a 4194304-byte range [line 70] (node: YT Relay Video)";
    expect(friendlyPlatformError(raw, "YOUTUBE")).toBe("Couldn't read the media file — try again.");
  });

  test("a dropped connection", () => {
    const raw = "read ECONNRESET [line 12] (node: YT Relay Video)";
    expect(friendlyPlatformError(raw, "YOUTUBE")).toBe(
      "The connection to the platform dropped while posting — try again.",
    );
  });
});
