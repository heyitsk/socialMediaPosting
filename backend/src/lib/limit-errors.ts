import type { CooldownReason } from "@prisma/client";
import type { PostablePlatform } from "./capabilities";

// Which platform errors mean "stop sending to this account for a while", and
// for how long (websitePlan.md §13.7). Read from the same raw error text
// platform-error.ts turns into messages: n8n's
//   400 - "{\"error\":{\"message\":\"...\",\"code\":368, ...}}" (node: Publish Photo Post)
// or the backend's own "... failed (403): {...}" from the video-status poller.

const HOUR_MS = 60 * 60_000;

export type PauseLength =
  | { kind: "FOR"; ms: number }
  // Until the platform's calendar day resets.
  | { kind: "NEXT_DAY"; window: "UTC_DAY" | "PACIFIC_DAY" }
  // Until the oldest post we sent in the last 24 h leaves the window.
  | { kind: "ROLLING_24H" };

export interface LimitError {
  reason: CooldownReason;
  // Pauses every account on the platform — YouTube's project quota.
  appWide: boolean;
  length: PauseLength;
  // Shown inside "paused (…)".
  message: string;
}

interface LimitRule extends LimitError {
  platforms?: PostablePlatform[];
  status?: number;
  text?: RegExp;
}

const META: PostablePlatform[] = ["FACEBOOK", "INSTAGRAM", "THREADS"];

// A JSON "code" field in text that may be escaped once: "code":368 or
// \"code\":368. Not error_subcode — that has a _ before "code".
const metaCode = (codes: string) => new RegExp(`\\\\?"code\\\\?":\\s*(?:${codes})\\b`);

// First match wins.
const RULES: LimitRule[] = [
  // Meta's spam check. Retrying makes it last longer; it has lasted ~24 h.
  {
    platforms: META,
    text: /\\?"code\\?":\s*368\b|temporarily blocked/i,
    reason: "ABUSE_BLOCK",
    appWide: false,
    length: { kind: "FOR", ms: 24 * HOUR_MS },
    message: "Meta flagged the posting as spam",
  },
  // Instagram's posts-per-24-hours limit (code 9, subcode 2207042).
  {
    platforms: ["INSTAGRAM"],
    text: /2207042/,
    reason: "QUOTA",
    appWide: false,
    length: { kind: "ROLLING_24H" },
    message: "Instagram's 24-hour posting limit was reached",
  },
  // Threads doesn't document its over-the-limit error; its limit is the same
  // rolling 24 h shape as Instagram's.
  {
    platforms: ["THREADS"],
    text: /publishing limit|posting limit|quota/i,
    reason: "QUOTA",
    appWide: false,
    length: { kind: "ROLLING_24H" },
    message: "Threads' 24-hour posting limit was reached",
  },
  // Graph API throttling: app, user, Page and business-use-case limits.
  {
    platforms: META,
    text: metaCode("4|17|32|613|80001|80002"),
    reason: "RATE_LIMIT",
    appWide: false,
    length: { kind: "FOR", ms: HOUR_MS },
    message: "Meta is limiting requests for this account",
  },
  // The project's daily units or uploads, shared by every channel.
  {
    platforms: ["YOUTUBE"],
    text: /quotaExceeded/,
    reason: "QUOTA",
    appWide: true,
    length: { kind: "NEXT_DAY", window: "PACIFIC_DAY" },
    message: "the app's daily YouTube quota is used up",
  },
  {
    platforms: ["YOUTUBE"],
    text: /uploadLimitExceeded/,
    reason: "QUOTA",
    appWide: false,
    length: { kind: "FOR", ms: 24 * HOUR_MS },
    message: "YouTube's upload limit for this channel was reached",
  },
  {
    platforms: ["YOUTUBE"],
    text: /rateLimitExceeded|userRateLimitExceeded/,
    reason: "RATE_LIMIT",
    appWide: false,
    length: { kind: "FOR", ms: HOUR_MS },
    message: "YouTube is limiting requests for this channel",
  },
  // LinkedIn's limits are per member per UTC day.
  {
    platforms: ["LINKEDIN"],
    status: 429,
    reason: "QUOTA",
    appWide: false,
    length: { kind: "NEXT_DAY", window: "UTC_DAY" },
    message: "LinkedIn's daily limit for this account was reached",
  },
  {
    status: 429,
    reason: "RATE_LIMIT",
    appWide: false,
    length: { kind: "FOR", ms: HOUR_MS },
    message: "the platform is limiting requests for this account",
  },
];

// n8n's "429 - ..." or the poller's "... (429): ...".
function httpStatus(raw: string): number | null {
  const match = /^(\d{3}) - /.exec(raw.trim()) ?? /\((\d{3})\):/.exec(raw);
  return match ? Number(match[1]) : null;
}

export function classifyLimitError(raw: string, platform: PostablePlatform): LimitError | null {
  const status = httpStatus(raw);
  const rule = RULES.find(
    (candidate) =>
      (!candidate.platforms || candidate.platforms.includes(platform)) &&
      (candidate.status === undefined || candidate.status === status) &&
      (!candidate.text || candidate.text.test(raw)),
  );
  if (!rule) return null;
  const { reason, appWide, length, message } = rule;
  return { reason, appWide, length, message };
}
