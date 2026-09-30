import { type Context, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_SERVICE_NAME,
  ATTR_URL_FULL,
} from "@opentelemetry/semantic-conventions";
import { PrismaInstrumentation } from "@prisma/instrumentation";

// OpenTelemetry bootstrap (websitePlan.md §14.3). Must be the first import in
// index.ts so it runs before @prisma/client loads. app.ts never imports it, so
// `bun test` and `bun run openapi` stay silent.
//
// Configured only through the standard OTEL_* variables — no env.ts entries:
// OTEL_EXPORTER_OTLP_ENDPOINT (local otel-lgtm or Grafana Cloud),
// OTEL_EXPORTER_OTLP_HEADERS (Grafana Cloud auth), OTEL_RESOURCE_ATTRIBUTES
// (e.g. service.version=<git sha>), OTEL_SDK_DISABLED. Telemetry is off unless
// an endpoint is set, so a dev without the otel-lgtm container gets no export
// errors.
//
// Under Bun there's no auto-instrumentation: Bun.serve and fetch don't go
// through node:http. HTTP spans come from @hono/otel in app.ts; Prisma
// instruments itself once PrismaInstrumentation is registered.

// Drops the query string from url.full before a span is exported. OAuth
// callbacks carry `code` and `state` there. Runs in onStart because
// @hono/otel sets url.full when it creates the span.
class RedactUrlProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    const url = span.attributes[ATTR_URL_FULL];
    if (typeof url === "string" && url.includes("?")) {
      span.setAttribute(ATTR_URL_FULL, url.slice(0, url.indexOf("?")));
    }
  }
  onEnd(): void {}
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

// @hono/otel marks a span as failed whenever the request threw, which
// includes every HTTPException — a 401 from /api/me is how the frontend learns
// there's no session. Per the HTTP semantic conventions a 4xx isn't a server
// error, so hand the exporter a copy of those spans with the status cleared.
// (The SDK has no hook to change a span's status just before it ends.)
class ClientErrorStatusProcessor implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan): void {
    const status = span.attributes[ATTR_HTTP_RESPONSE_STATUS_CODE];
    const isClientError =
      span.kind === SpanKind.SERVER && typeof status === "number" && status >= 400 && status < 500;
    if (isClientError && span.status.code === SpanStatusCode.ERROR) {
      this.next.onEnd(
        Object.create(span, { status: { value: { code: SpanStatusCode.UNSET } } }) as ReadableSpan,
      );
      return;
    }
    this.next.onEnd(span);
  }
  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }
  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
}

const enabled =
  !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== "true";

if (enabled) {
  const sdk = new NodeSDK({
    // OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES still override these.
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "smposting-backend",
      "deployment.environment.name": process.env.NODE_ENV ?? "development",
      "process.runtime.name": "bun",
      "process.runtime.version": Bun.version,
    }),
    spanProcessors: [
      new RedactUrlProcessor(),
      new ClientErrorStatusProcessor(new BatchSpanProcessor(new OTLPTraceExporter())),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 30_000,
      }),
    ],
    // Fed by lib/logger.ts.
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [new PrismaInstrumentation()],
  });
  sdk.start();

  // Flush buffered spans, metrics and logs before the process goes away.
  const shutdown = () => {
    sdk.shutdown().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
