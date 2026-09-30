import { BullMQOtel } from "bullmq-otel";
import { currentTraceparent, linkActiveSpanTo } from "../lib/tracing";

// Passed as `telemetry` to every Queue and Worker (websitePlan.md §14.5):
// add → process spans, with the producer's trace context carried in the job.
// Created at import time, after otel.ts has started the SDK (index.ts imports
// it first) — a meter fetched before that would stay a no-op.
export const telemetry = new BullMQOtel({ tracerName: "smposting-queues", enableMetrics: true });

// Set on job data by jobs that run later (see laterJob).
export interface TraceLinkData {
  traceLink?: string;
}

// A job that runs later (a schedule, a deadline, a poll) starts its own trace
// in the worker, linked back to the one that queued it, instead of joining
// it: a trace stretched over hours reports the wait as its duration and
// buries the requests that are really slow. §14.10 decision 4.
export function laterJob(): { data: TraceLinkData; opts: { telemetry: { omitContext: true } } } {
  return { data: { traceLink: currentTraceparent() }, opts: { telemetry: { omitContext: true } } };
}

// Call first in a worker's processor.
export function linkToProducer(data: TraceLinkData): void {
  linkActiveSpanTo(data.traceLink);
}
