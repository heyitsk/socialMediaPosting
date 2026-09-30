import { describe, expect, test } from "bun:test";
import {
  APP_WIDE_ACCOUNT_ID,
  budgetsFor,
  contentHash,
  dayStart,
  fitsAt,
  nextDayStart,
  nextFreeTime,
  type PostingPolicy,
  type Slot,
} from "./posting-limits";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 1, 10, 0); // Oct 1 2026, 10:00 UTC

const rolling = (over: Partial<PostingPolicy> = {}): PostingPolicy => ({
  perDay: 5,
  window: "ROLLING_24H",
  perHour: 2,
  minGapMs: 10 * MIN,
  cost: () => 1,
  ...over,
});

const at = (...offsets: number[]): Slot[] =>
  offsets.map((offset) => ({ at: T0 + offset, cost: 1 }));

describe("calendar days", () => {
  test("UTC day", () => {
    expect(dayStart("UTC_DAY", T0)).toBe(Date.UTC(2026, 9, 1));
    expect(nextDayStart("UTC_DAY", T0)).toBe(Date.UTC(2026, 9, 2));
  });

  test("Pacific day in summer time (UTC-7)", () => {
    // 10:00 UTC Oct 1 = 03:00 PDT Oct 1; midnight PDT = 07:00 UTC.
    expect(dayStart("PACIFIC_DAY", T0)).toBe(Date.UTC(2026, 9, 1, 7));
    // 05:00 UTC Oct 1 is still Sep 30 in Los Angeles.
    expect(dayStart("PACIFIC_DAY", Date.UTC(2026, 9, 1, 5))).toBe(Date.UTC(2026, 8, 30, 7));
  });

  test("Pacific day across the November DST change (25 h day)", () => {
    // Nov 1 2026 starts at 00:00 PDT (07:00 UTC); Nov 2 at 00:00 PST (08:00 UTC).
    const nov1 = Date.UTC(2026, 10, 1, 12);
    expect(dayStart("PACIFIC_DAY", nov1)).toBe(Date.UTC(2026, 10, 1, 7));
    expect(nextDayStart("PACIFIC_DAY", nov1)).toBe(Date.UTC(2026, 10, 2, 8));
  });

  test("Pacific day across the March DST change (23 h day)", () => {
    // Mar 14 2027 starts at 00:00 PST (08:00 UTC); Mar 15 at 00:00 PDT (07:00 UTC).
    const mar14 = Date.UTC(2027, 2, 14, 12);
    expect(dayStart("PACIFIC_DAY", mar14)).toBe(Date.UTC(2027, 2, 14, 8));
    expect(nextDayStart("PACIFIC_DAY", mar14)).toBe(Date.UTC(2027, 2, 15, 7));
  });
});

describe("fitsAt", () => {
  test("empty account fits", () => {
    expect(fitsAt(rolling(), [], T0, 1)).toBe(true);
  });

  test("minimum gap applies on both sides", () => {
    expect(fitsAt(rolling(), at(0), T0 + 9 * MIN, 1)).toBe(false);
    expect(fitsAt(rolling(), at(0), T0 + 10 * MIN, 1)).toBe(true);
    // A scheduled send 5 min later blocks this one too.
    expect(fitsAt(rolling(), at(5 * MIN), T0, 1)).toBe(false);
  });

  test("hourly cap counts every hour the send falls in", () => {
    const slots = at(0, 20 * MIN);
    expect(fitsAt(rolling(), slots, T0 + 40 * MIN, 1)).toBe(false);
    expect(fitsAt(rolling(), slots, T0 + HOUR, 1)).toBe(true);
    // Squeezed between two later sends that are within an hour of it.
    expect(fitsAt(rolling(), at(30 * MIN, 50 * MIN), T0, 1)).toBe(false);
  });

  test("rolling 24 h cap sums cost, including scheduled sends", () => {
    const policy = rolling({ perDay: 4, perHour: 0, minGapMs: 0 });
    const slots = at(0, 2 * HOUR, 4 * HOUR, 30 * HOUR);
    expect(fitsAt(policy, slots, T0 + 20 * HOUR, 1)).toBe(true); // 4 in [T0, T0+24h)
    expect(fitsAt(policy, slots, T0 + 20 * HOUR, 2)).toBe(false);
    expect(fitsAt(policy, [...slots, ...at(10 * HOUR)], T0 + 20 * HOUR, 1)).toBe(false);
  });

  test("calendar-day cap resets at midnight", () => {
    const policy = rolling({ window: "UTC_DAY", perDay: 3, perHour: 0, minGapMs: 0 });
    const slots = [{ at: Date.UTC(2026, 9, 1, 1), cost: 3 }];
    expect(fitsAt(policy, slots, Date.UTC(2026, 9, 1, 23), 1)).toBe(false);
    expect(fitsAt(policy, slots, Date.UTC(2026, 9, 2, 0), 1)).toBe(true);
  });
});

describe("nextFreeTime", () => {
  test("now, when there's room", () => {
    expect(nextFreeTime(rolling(), [], T0, 1)).toBe(T0);
  });

  test("waits out the gap", () => {
    expect(nextFreeTime(rolling(), at(-3 * MIN), T0, 1)).toBe(T0 + 7 * MIN);
  });

  test("waits for the hour to roll", () => {
    expect(nextFreeTime(rolling(), at(-50 * MIN, -30 * MIN), T0, 1)).toBe(T0 + 10 * MIN);
  });

  test("waits for the oldest send to leave the rolling 24 h", () => {
    const policy = rolling({ perHour: 0, minGapMs: 0 });
    const slots = at(-23 * HOUR, -20 * HOUR, -10 * HOUR, -5 * HOUR, -1 * HOUR);
    expect(nextFreeTime(policy, slots, T0, 1)).toBe(T0 + HOUR);
  });

  test("next calendar day when today is full", () => {
    const policy = rolling({ window: "UTC_DAY", perDay: 1, perHour: 0, minGapMs: 0 });
    expect(nextFreeTime(policy, at(-HOUR), T0, 1)).toBe(Date.UTC(2026, 9, 2));
  });

  test("fits between two scheduled sends when there's room", () => {
    const policy = rolling({ perHour: 0, minGapMs: 10 * MIN });
    expect(nextFreeTime(policy, at(5 * MIN, 30 * MIN), T0, 1)).toBe(T0 + 15 * MIN);
  });

  test("null when nothing fits within the horizon", () => {
    const policy = rolling({ perHour: 0, minGapMs: 0, perDay: 2 });
    expect(nextFreeTime(policy, [], T0, 3)).toBeNull();
    expect(nextFreeTime(policy, at(0, 1), T0, 1, 2 * HOUR)).toBeNull();
  });

  test("the result always fits", () => {
    const policy = rolling({ perDay: 4, perHour: 2, minGapMs: 7 * MIN });
    const slots = at(-40 * MIN, -5 * MIN, 12 * MIN, 3 * HOUR, 26 * HOUR);
    const next = nextFreeTime(policy, slots, T0, 1);
    expect(next).not.toBeNull();
    expect(fitsAt(policy, slots, next as number, 1)).toBe(true);
    // And nothing earlier does, checked minute by minute.
    for (let t = T0; t < (next as number); t += MIN) {
      expect(fitsAt(policy, slots, t, 1)).toBe(false);
    }
  });
});

describe("budgetsFor", () => {
  test("YouTube also draws from the app-wide budget", () => {
    const budgets = budgetsFor("YOUTUBE", "UCabc", "standard");
    expect(budgets.map((budget) => budget.platformAccountId)).toEqual([
      "UCabc",
      APP_WIDE_ACCOUNT_ID,
    ]);
    expect(budgetsFor("INSTAGRAM", "17841", "standard")).toHaveLength(1);
  });

  test("dev profile halves caps and doubles gaps", () => {
    const [standard] = budgetsFor("FACEBOOK", "p", "standard");
    const [dev] = budgetsFor("FACEBOOK", "p", "dev");
    expect(dev?.policy.perDay).toBe(Math.floor((standard?.policy.perDay ?? 0) / 2));
    expect(dev?.policy.minGapMs).toBe((standard?.policy.minGapMs ?? 0) * 2);
  });

  test("LinkedIn costs API calls", () => {
    const [linkedIn] = budgetsFor("LINKEDIN", "urn", "standard");
    expect(linkedIn?.policy.cost("TEXT", 0)).toBe(1);
    expect(linkedIn?.policy.cost("IMAGE", 1)).toBe(3);
    expect(linkedIn?.policy.cost("CAROUSEL", 4)).toBe(9);
  });
});

describe("contentHash", () => {
  test("ignores case, spacing and media order", () => {
    expect(contentHash("  Hello   World ", ["b", "a"])).toBe(
      contentHash("hello world", ["a", "b"]),
    );
  });

  test("differs on caption or media", () => {
    expect(contentHash("hello", ["a"])).not.toBe(contentHash("hello!", ["a"]));
    expect(contentHash("hello", ["a"])).not.toBe(contentHash("hello", ["b"]));
  });
});
