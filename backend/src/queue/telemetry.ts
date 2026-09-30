import { metrics } from "@opentelemetry/api";
import type { Queue } from "bullmq";
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

// Jobs per queue and state, read from Redis each time metrics are exported
// (websitePlan.md §14.6). A growing `waiting` means the workers can't keep up;
// `delayed` is mostly schedules and is expected to be large.
const QUEUE_STATES = ["waiting", "delayed", "active", "failed"] as const;
const observedQueues: Queue[] = [];

metrics
  .getMeter("smposting-backend")
  .createObservableGauge("smposting.queue.jobs", { description: "Jobs per queue and state" })
  .addCallback(async (result) => {
    for (const queue of observedQueues) {
      const counts = await queue.getJobCounts(...QUEUE_STATES);
      for (const state of QUEUE_STATES) {
        result.observe(counts[state] ?? 0, { queue: queue.name, state });
      }
    }
  });

export function observeQueueDepth(queue: Queue): void {
  observedQueues.push(queue);
}
