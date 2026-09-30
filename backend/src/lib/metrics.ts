import { metrics, ValueType } from "@opentelemetry/api";

// Business metrics (websitePlan.md §14.6). Labels come only from small fixed
// sets — platform, media type, outcome, reason, queue, state. Never a
// workspace, user, post or account id: those belong in spans and logs, and
// as labels they'd blow through the metric series budget.
//
// The meter is fetched at import, after otel.ts has started the SDK (index.ts
// imports it first); without the SDK (tests) every instrument is a no-op.

const meter = metrics.getMeter("smposting-backend");

// Seconds, for dispatch calls and renders (videos take minutes).
const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800];

export const postsDispatched = meter.createCounter("smposting.posts.dispatched", {
  description: "Targets handed off to their n8n workflow",
});

// outcome: published | failed | cancelled. A late SUCCESS after a deadline
// FAILED counts once as each.
export const postsCompleted = meter.createCounter("smposting.posts.completed", {
  description: "Targets reaching a final status",
});

export const postsDeadlineHits = meter.createCounter("smposting.posts.deadline_hits", {
  description: "Targets failed because n8n never called back",
});

export const n8nDispatchDuration = meter.createHistogram("smposting.n8n.dispatch.duration", {
  description: "Time for n8n to accept a dispatch",
  unit: "s",
  valueType: ValueType.DOUBLE,
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

export const limitPauses = meter.createCounter("smposting.limits.pauses", {
  description: "Accounts paused after a limit or spam error",
});

// reason: duplicate | no_slot | paused.
export const limitRefusals = meter.createCounter("smposting.limits.refusals", {
  description: "Targets refused at create or retry by the posting limiter",
});

export const renderDuration = meter.createHistogram("smposting.render.duration", {
  description: "Time to render one per-platform rendition",
  unit: "s",
  valueType: ValueType.DOUBLE,
  advice: { explicitBucketBoundaries: DURATION_BUCKETS },
});

export const mediaUploads = meter.createCounter("smposting.media.uploads", {
  description: "Completed uploads, by whether they passed the checks",
});

export function secondsSince(start: number): number {
  return (performance.now() - start) / 1000;
}
