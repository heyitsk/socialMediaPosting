// Turns the raw error text n8n sends back into something a person can read.
// PostLog.errorMessage keeps the raw text for debugging; this runs when it's
// shown. n8n's HTTP Request node reports an API failure as
//   400 - "{\"error\":{\"message\":\"...\", ...}}" (node: Publish Image)
// i.e. the status code, then the response body as a JSON-encoded string.

const MAX_LENGTH = 300;

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
  if (status === 401 || status === 403) {
    return "The platform rejected this account's access — try reconnecting the account.";
  }
  if (status === 429) return "The platform is rate limiting this account — try again later.";
  if (status >= 500) return "The platform had a temporary problem — try again.";
  return `The platform rejected the post (HTTP ${status}).`;
}

function truncate(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

export function friendlyPlatformError(raw: string): string {
  const text = raw.replace(/\s*\((?:last )?node: [^)]*\)\s*$/, "").trim();
  if (!text) return "Posting failed";

  const http = /^(\d{3}) - ([\s\S]*)$/.exec(text);
  if (!http) return truncate(text);

  const status = Number(http[1]);
  const body = parseBody(http[2] ?? "");
  const message = messageFromBody(body);
  if (message) return truncate(message);
  // A plain-text body can be shown as-is; HTML error pages can't.
  if (typeof body === "string" && body && !body.startsWith("<")) return truncate(body);
  return fallbackForStatus(status);
}
