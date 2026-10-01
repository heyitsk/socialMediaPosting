import { context, trace } from "@opentelemetry/api";
import { type AnyValue, logs, SeverityNumber } from "@opentelemetry/api-logs";
import pino from "pino";
import PinoPretty from "pino-pretty";

// App-wide structured logger (websitePlan.md §14.4). Put ids and other
// details in the first argument and keep the message short and fixed, so
// lines group in Loki:
//   logger.error({ postId, platform, err }, "publish failed")
//
// Every line goes to stdout (pretty in dev, JSON in production) and, when
// otel.ts has started the SDK, to the OTel Logs SDK → OTLP → Loki, tagged
// with the active trace so Grafana links the line to its trace. Deliberately
// no pino transport: those run in a worker thread, where the caller's trace
// context is gone.

// pino level number → OTel severity.
const SEVERITY: Record<number, SeverityNumber> = {
  10: SeverityNumber.TRACE,
  20: SeverityNumber.DEBUG,
  30: SeverityNumber.INFO,
  40: SeverityNumber.WARN,
  50: SeverityNumber.ERROR,
  60: SeverityNumber.FATAL,
};

// Fields pino adds itself, or that the OTLP record carries natively.
const RESERVED = new Set(["level", "time", "msg", "err", "trace_id", "span_id"]);

const stdout =
  process.env.NODE_ENV === "production"
    ? process.stdout
    : PinoPretty({ sync: true, colorize: true, ignore: "trace_id,span_id" });

function toOtlp(line: string): void {
  const record = JSON.parse(line) as Record<string, unknown>;
  const attributes: Record<string, AnyValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (RESERVED.has(key) || value === undefined) continue;
    attributes[key] =
      value !== null && typeof value === "object" ? JSON.stringify(value) : (value as AnyValue);
  }
  // pino's err serializer turns an Error into { type, message, stack }.
  const err = record.err as { type?: string; message?: string; stack?: string } | undefined;
  if (err && typeof err === "object") {
    attributes["exception.type"] = err.type ?? "Error";
    attributes["exception.message"] = err.message ?? "";
    if (err.stack) attributes["exception.stacktrace"] = err.stack;
  } else if (err !== undefined) {
    attributes["exception.message"] = String(err);
  }

  const level = record.level as number;
  // Looked up per line: a logger fetched before otel.ts starts the SDK would
  // stay a no-op forever.
  logs.getLogger("smposting-backend").emit({
    timestamp: record.time as number,
    severityNumber: SEVERITY[level] ?? SeverityNumber.INFO,
    severityText: pino.levels.labels[level]?.toUpperCase(),
    body: record.msg as string | undefined,
    attributes,
    // pino writes synchronously, so this is still the caller's context.
    context: context.active(),
  });
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined,
    // Also on stdout, so lines scraped from container logs (K8s later) still
    // join their trace.
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId } = span.spanContext();
      return { trace_id: traceId, span_id: spanId };
    },
  },
  {
    write(line: string) {
      stdout.write(line);
      toOtlp(line);
    },
  },
);
