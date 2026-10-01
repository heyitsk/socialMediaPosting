import {
  context,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

// Manual tracing helpers (websitePlan.md §14.5). Everything here is a no-op
// when otel.ts hasn't started the SDK (tests, `bun run openapi`).

const tracer = trace.getTracer("smposting-backend");

function endWithError(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : new Error(String(err)));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

// A background tick (reconciler, cleaner) gets its own trace, so its Prisma
// queries aren't a pile of orphan root spans.
export function withRootSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { root: true }, async (span) => {
    try {
      return await fn();
    } catch (err) {
      endWithError(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

// Bun's fetch isn't auto-instrumented, so outbound calls go through this: a
// CLIENT span per request. The query string is never recorded — Graph API
// URLs carry access_token there.
//
// `propagate` sends our traceparent along. Only for our own services (n8n),
// whose spans then join this trace — not for platform APIs.
export function tracedFetch(
  input: string | URL,
  init: RequestInit = {},
  { propagate = false }: { propagate?: boolean } = {},
): Promise<Response> {
  const url = new URL(input);
  const method = (init.method ?? "GET").toUpperCase();
  return tracer.startActiveSpan(
    `${method} ${url.host}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": method,
        "server.address": url.hostname,
        "url.full": `${url.origin}${url.pathname}`,
      },
    },
    async (span) => {
      const headers = new Headers(init.headers);
      if (propagate) {
        propagation.inject(context.active(), headers, {
          set: (carrier, key, value) => carrier.set(key, value),
        });
      }
      try {
        const response = await fetch(input, { ...init, headers });
        span.setAttribute("http.response.status_code", response.status);
        if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        return response;
      } catch (err) {
        endWithError(span, err);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

// W3C traceparent of the active span, to store with work that runs later.
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

// Links the active span back to a stored traceparent — a clickable jump in
// Tempo, without making this span part of that (possibly hours-old) trace.
export function linkActiveSpanTo(traceparent: string | undefined): void {
  if (!traceparent) return;
  const linked = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, { traceparent }));
  if (linked) trace.getActiveSpan()?.addLink({ context: linked });
}
