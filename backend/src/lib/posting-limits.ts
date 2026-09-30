import { createHash } from "node:crypto";
import type { MediaType } from "@prisma/client";
import type { PostablePlatform } from "./capabilities";

// How fast and how often we let posts reach each platform (websitePlan.md
// §13). The published limits are in §13.1; these caps sit at about half of
// them, and add pacing because Meta's spam check (code 368) reacts to bursts,
// not to a count running out. The numbers are fixed — workspaces can't change
// them (§13.9 decision 2).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The same caption and media to the same account within this long is refused.
export const DUPLICATE_WINDOW_MS = DAY_MS;

// Stands in for the platform account id in the app-wide budget (YouTube's
// project quota is shared by every channel of every workspace).
export const APP_WIDE_ACCOUNT_ID = "*";

// ROLLING_24H: any 24 hours (Meta). UTC_DAY / PACIFIC_DAY: a calendar day
// that resets at midnight in that zone (LinkedIn / YouTube).
export type LimitWindow = "ROLLING_24H" | "UTC_DAY" | "PACIFIC_DAY";

export interface PostingPolicy {
  // Budget per window, in `cost` units.
  perDay: number;
  window: LimitWindow;
  // Sends in any rolling hour, whatever their cost. 0 = no hourly cap.
  perHour: number;
  // Between two sends to the same account, either side of it.
  minGapMs: number;
  // What one post uses of `perDay`.
  cost: (mediaType: MediaType, mediaCount: number) => number;
}

const onePerPost = () => 1;

// LinkedIn's limit is 150 API calls per member per day, not posts. Counted
// from linkedin-poster.json: an image is initializeUpload + PUT + post, and a
// carousel does the first two per image. A video is init, one PUT per 4 MiB
// part, finalize and post, plus the backend's status polls — 12 covers a
// typical ~20 MB video.
function linkedInCalls(mediaType: MediaType, mediaCount: number): number {
  switch (mediaType) {
    case "IMAGE":
      return 3;
    case "CAROUSEL":
      return 1 + 2 * mediaCount;
    case "VIDEO":
      return 12;
    default:
      return 1;
  }
}

const STANDARD: Record<PostablePlatform, PostingPolicy> = {
  // No post limit is published for Pages; these are guesses, kept strict.
  FACEBOOK: {
    perDay: 25,
    window: "ROLLING_24H",
    perHour: 4,
    minGapMs: 5 * MINUTE_MS,
    cost: onePerPost,
  },
  // Published: 50-100 per rolling 24 h.
  INSTAGRAM: {
    perDay: 25,
    window: "ROLLING_24H",
    perHour: 5,
    minGapMs: 3 * MINUTE_MS,
    cost: onePerPost,
  },
  // Published: 250 per rolling 24 h.
  THREADS: {
    perDay: 100,
    window: "ROLLING_24H",
    perHour: 10,
    minGapMs: MINUTE_MS,
    cost: onePerPost,
  },
  // Published: 150 calls per member per UTC day. About 25-30 posts.
  LINKEDIN: {
    perDay: 100,
    window: "UTC_DAY",
    perHour: 4,
    minGapMs: 5 * MINUTE_MS,
    cost: linkedInCalls,
  },
  // Per channel; YouTube doesn't publish this one (uploadLimitExceeded).
  YOUTUBE: {
    perDay: 6,
    window: "PACIFIC_DAY",
    perHour: 2,
    minGapMs: 10 * MINUTE_MS,
    cost: onePerPost,
  },
};

// YouTube's project quota: 100 videos.insert a day for everyone together.
// Its 10,000 units (status polls, about 15 per upload) run out later than
// the inserts do, so only the inserts are counted.
const STANDARD_APP_WIDE: Partial<Record<PostablePlatform, PostingPolicy>> = {
  YOUTUBE: { perDay: 80, window: "PACIFIC_DAY", perHour: 0, minGapMs: 0, cost: onePerPost },
};

// "dev" halves every cap and doubles every gap — Meta is strictest with apps
// still in development mode, which is where the Sep 2026 block happened.
function forProfile(policy: PostingPolicy, profile: PostingLimitsProfile): PostingPolicy {
  if (profile === "standard") return policy;
  return {
    ...policy,
    perDay: Math.max(1, Math.floor(policy.perDay / 2)),
    perHour: policy.perHour === 0 ? 0 : Math.max(1, Math.floor(policy.perHour / 2)),
    minGapMs: policy.minGapMs * 2,
  };
}

export type PostingLimitsProfile = "standard" | "dev";

export interface Budget {
  platformAccountId: string;
  policy: PostingPolicy;
}

// Every budget a post to this account draws from: the account's own, plus
// the app-wide one where the platform has it. `profile` is
// env.POSTING_LIMITS_PROFILE — passed in so this file stays free of env and
// can be tested on its own.
export function budgetsFor(
  platform: PostablePlatform,
  platformAccountId: string,
  profile: PostingLimitsProfile,
): Budget[] {
  const budgets: Budget[] = [
    { platformAccountId, policy: forProfile(STANDARD[platform], profile) },
  ];
  const appWide = STANDARD_APP_WIDE[platform];
  if (appWide) {
    budgets.push({ platformAccountId: APP_WIDE_ACCOUNT_ID, policy: forProfile(appWide, profile) });
  }
  return budgets;
}

// --- Calendar days ---

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

// How far Pacific time is ahead of UTC at this instant (negative: -7 h / -8 h).
function pacificOffsetMs(at: number): number {
  const parts = PACIFIC.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

// Start of the calendar day containing `at`, as a UTC timestamp.
export function dayStart(window: "UTC_DAY" | "PACIFIC_DAY", at: number): number {
  if (window === "UTC_DAY") return Math.floor(at / DAY_MS) * DAY_MS;
  const localMidnight = Math.floor((at + pacificOffsetMs(at)) / DAY_MS) * DAY_MS;
  // DST changes at 2 am, so midnight has the offset of the instant it names.
  const guess = localMidnight - pacificOffsetMs(at);
  return localMidnight - pacificOffsetMs(guess);
}

// A day is 23-25 hours long, so 36 hours on always lands in the next one.
export function nextDayStart(window: "UTC_DAY" | "PACIFIC_DAY", at: number): number {
  return dayStart(window, dayStart(window, at) + 36 * HOUR_MS);
}

// --- Fitting a send into the slots already taken ---

// A send already allowed through: when it goes out and what it costs.
export interface Slot {
  at: number;
  cost: number;
}

// The most any window of `lengthMs` that contains `at` already holds. Such a
// window's total only peaks when it starts on a taken slot or on `at` itself.
function busiestWindow(slots: Slot[], at: number, lengthMs: number, weigh: (slot: Slot) => number) {
  let most = 0;
  for (const start of [
    at,
    ...slots.filter((s) => s.at > at - lengthMs && s.at <= at).map((s) => s.at),
  ]) {
    let total = 0;
    for (const slot of slots) {
      if (slot.at >= start && slot.at < start + lengthMs) total += weigh(slot);
    }
    most = Math.max(most, total);
  }
  return most;
}

// Whether a send costing `cost` at `at` keeps every window within the policy.
// `slots` may include later, scheduled sends — those count too.
export function fitsAt(policy: PostingPolicy, slots: Slot[], at: number, cost: number): boolean {
  if (policy.minGapMs > 0 && slots.some((slot) => Math.abs(slot.at - at) < policy.minGapMs)) {
    return false;
  }
  if (policy.perHour > 0 && busiestWindow(slots, at, HOUR_MS, () => 1) + 1 > policy.perHour) {
    return false;
  }
  if (policy.window === "ROLLING_24H") {
    return busiestWindow(slots, at, DAY_MS, (slot) => slot.cost) + cost <= policy.perDay;
  }
  const start = dayStart(policy.window, at);
  const end = nextDayStart(policy.window, at);
  const used = slots
    .filter((slot) => slot.at >= start && slot.at < end)
    .reduce((sum, slot) => sum + slot.cost, 0);
  return used + cost <= policy.perDay;
}

// The earliest time at or after `earliest` where the send fits, or null if
// there's none within `horizonMs`. A time can only become free when it moves
// past a slot, a gap, an hour or day after a slot, or a calendar day
// boundary, so those are the only times worth trying.
export function nextFreeTime(
  policy: PostingPolicy,
  slots: Slot[],
  earliest: number,
  cost: number,
  horizonMs = 7 * DAY_MS,
): number | null {
  if (cost > policy.perDay) return null;
  const latest = earliest + horizonMs;
  const candidates = new Set<number>([earliest]);
  for (const slot of slots) {
    candidates.add(slot.at + 1);
    candidates.add(slot.at + policy.minGapMs);
    candidates.add(slot.at + HOUR_MS);
    if (policy.window === "ROLLING_24H") candidates.add(slot.at + DAY_MS);
  }
  if (policy.window !== "ROLLING_24H") {
    for (
      let day = nextDayStart(policy.window, earliest);
      day <= latest;
      day = nextDayStart(policy.window, day)
    ) {
      candidates.add(day);
    }
  }
  const ordered = [...candidates]
    .filter((at) => at >= earliest && at <= latest)
    .sort((a, b) => a - b);
  return ordered.find((at) => fitsAt(policy, slots, at, cost)) ?? null;
}

// --- Duplicate guard ---

// What identifies a media file across uploads: the same file uploaded twice
// gets a new asset id but keeps its exact size and shape. Posts from before
// S3 uploads pass their public URL instead.
export function mediaFingerprint(asset: {
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}): string {
  return [
    asset.contentType,
    asset.sizeBytes,
    asset.width,
    asset.height,
    asset.durationSeconds,
  ].join(":");
}

// Case, spacing and media order don't make a post different.
export function contentHash(caption: string, media: string[]): string {
  const text = caption.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256")
    .update(`${text}\n${[...media].sort().join("\n")}`)
    .digest("hex");
}
