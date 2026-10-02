import type { Platform } from "@prisma/client";

// Turns the raw error text n8n sends back into something a person can read.
// PostLog.errorMessage keeps the raw text for debugging; this runs when it's
// shown. n8n's HTTP Request node reports an API failure as
//   400 - "{\"error\":{\"message\":\"...\", ...}}" (node: Publish Image)
// i.e. the status code, then the response body as a JSON-encoded string. The
// Build Error Result nodes may also append the JS stack (" - AxiosError: ...").
// The video relay Code nodes (websitePlan.md §15) throw the same
// "<status> - <body>" shape, which n8n suffixes with " [line N]"; a failed
// read of our own S3 object is prefixed "Reading the media file failed: ".
//
// Order of preference: a matching ERROR_RULES entry, then the platform's own
// message pulled out of the response body, then a sentence per status code.

const MAX_LENGTH = 300;

interface ErrorRule {
  // Every condition given must match.
  platform?: Platform;
  // The n8n node that failed.
  node?: RegExp;
  status?: (status: number) => boolean;
  // Tested against the raw text, response body included.
  text?: RegExp;
  message: string;
}

// An expired or revoked token: nothing but reconnecting the account fixes
// it, so retrying is pointless. "reconnect the account" is what
// service/youtube-token.ts throws when Google refuses the refresh token.
const ACCOUNT_ACCESS_TEXT = [
  /\\?"code\\?":\s*190\b|Error validating access token|session has (?:expired|been invalidated)/i,
  /EXPIRED_ACCESS_TOKEN|REVOKED_ACCESS_TOKEN|invalid_grant|Invalid Credentials|reconnect the account/,
];

export function isAccountAccessError(raw: string): boolean {
  return ACCOUNT_ACCESS_TEXT.some((pattern) => pattern.test(raw));
}

// Known failures, first match wins. Add new cases here.
const ERROR_RULES: ErrorRule[] = [
  // --- Our side: n8n couldn't read the uploaded file ---
  {
    node: /Download|Probe/,
    status: (status) => status === 403 || status === 404,
    message:
      "Couldn't read the media file — it may have been removed (uploads are kept 15 days). Create the post again.",
  },
  {
    node: /Download|Probe/,
    message: "Couldn't read the media file — try again.",
  },
  {
    text: /^Reading the media file failed: 40[34]\b/,
    message:
      "Couldn't read the media file — it may have been removed (uploads are kept 15 days). Create the post again.",
  },
  {
    text: /^Reading the media file failed/,
    message: "Couldn't read the media file — try again.",
  },

  // --- Account access ---
  ...ACCOUNT_ACCESS_TEXT.map((text) => ({
    text,
    message: "This account's access has expired — reconnect it on the Dashboard.",
  })),
  {
    status: (status) => status === 401,
    message: "The platform didn't accept this account's login — reconnect it on the Dashboard.",
  },

  // --- Limits (these also pause the account, lib/limit-errors.ts) ---
  {
    text: /\\?"code\\?":\s*368\b|temporarily blocked/i,
    message:
      "Meta flagged this as spam and blocked posting from this account for now — it's paused for 24 hours, and retrying sooner makes the block longer.",
  },
  {
    platform: "INSTAGRAM",
    text: /2207042/,
    message: "This Instagram account has reached its limit of posts per 24 hours.",
  },
  {
    platform: "YOUTUBE",
    text: /quotaExceeded/,
    message:
      "The app's daily YouTube quota is used up — YouTube posts resume after midnight Pacific time.",
  },
  {
    platform: "YOUTUBE",
    text: /uploadLimitExceeded/,
    message: "YouTube's upload limit for this channel is used up — try again tomorrow.",
  },
  {
    text: /rate limit|too many (?:requests|calls)|\\?"code\\?":\s*(?:4|17|32|613)\b/i,
    message: "The platform is limiting posts from this account right now — try again later.",
  },
  {
    status: (status) => status === 429,
    message: "The platform is limiting posts from this account right now — try again later.",
  },

  // --- Media the platform won't take ---
  {
    platform: "LINKEDIN",
    text: /FILE_SIZE_OUT_OF_RANGE/,
    message: "LinkedIn doesn't accept this video's file size (it takes 75 KB to 500 MB).",
  },
  {
    text: /PROCESSING_FAILED|CORRUPTED_ENTITY/,
    message:
      "The platform couldn't process the video — re-export it as MP4 (H.264 video, AAC audio) and post again.",
  },
  {
    text: /aspect ratio/i,
    message:
      "The platform doesn't accept this image or video's aspect ratio — crop or pad it for this platform in the composer.",
  },
  {
    text: /media (?:download has failed|could not be (?:fetched|downloaded))|failed to (?:fetch|download) (?:the )?media/i,
    message: "The platform couldn't download the media file — try again.",
  },
  {
    text: /duplicate/i,
    message: "The platform rejected this as a duplicate of a recent post.",
  },

  // --- Connection problems between n8n and the platform ---
  {
    text: /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up/,
    message: "The connection to the platform dropped while posting — try again.",
  },
];

// Graph API (Facebook/Instagram/Threads) and Google both use
// { error: { message } }; LinkedIn uses a top-level { message }; OAuth-style
// errors use error_description. Meta's error_user_msg is skipped on purpose —
// it's localized to the account's language, while `message` is always English.
function messageFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const nested = record.error;
  if (typeof nested === "object" && nested !== null) {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  for (const key of ["message", "error_description", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseBody(text: string): unknown {
  let value: unknown = text.trim();
  // Unwrap at most twice: the JSON-encoded string, then the JSON it contains.
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    const trimmed = value.trim();
    if (!/^["{[]/.test(trimmed)) break;
    try {
      value = JSON.parse(trimmed);
    } catch {
      break;
    }
  }
  return value;
}

function fallbackForStatus(status: number): string {
  if (status === 403) {
    return "The platform refused this post — the account may be missing a permission. Reconnecting it usually fixes this.";
  }
  if (status >= 500) return "The platform had a temporary problem — try again.";
  return `The platform rejected the post (HTTP ${status}).`;
}

function truncate(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

export function friendlyPlatformError(raw: string, platform?: Platform): string {
  const node = /\((?:last )?node: ([^)]*)\)\s*$/.exec(raw)?.[1];
  const text = raw
    .replace(/\s*\((?:last )?node: [^)]*\)\s*$/, "")
    // A stack appended by Build Error Result: " - AxiosError: ... at ...".
    .replace(/\s+-\s+[A-Za-z]*Error:\s[\s\S]*$/, "")
    // Where a Code node threw.
    .replace(/\s*\[line \d+\]$/, "")
    .trim();
  if (!text) return "Posting failed";

  const http = /^(\d{3}) - ([\s\S]*)$/.exec(text);
  const status = http ? Number(http[1]) : null;
  const rule = ERROR_RULES.find(
    (candidate) =>
      (!candidate.platform || candidate.platform === platform) &&
      (!candidate.node || (node !== undefined && candidate.node.test(node))) &&
      (!candidate.status || (status !== null && candidate.status(status))) &&
      (!candidate.text || candidate.text.test(text)),
  );
  if (rule) return rule.message;
  if (!http || status === null) return truncate(text);

  const body = parseBody(http[2] ?? "");
  const message = messageFromBody(body);
  if (message) return truncate(message);
  // A plain-text body can be shown as-is; HTML error pages can't.
  if (typeof body === "string" && body && !body.startsWith("<")) return truncate(body);
  return fallbackForStatus(status);
}
