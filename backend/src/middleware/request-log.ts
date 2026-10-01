import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { logger } from "../lib/logger";

// One line per request, in place of hono/logger's text lines. Registered right
// after the tracing middleware, so the line carries the request's trace id.
// The route pattern, not the raw path: ids stay out of the message and paths
// group in Loki.
export const requestLog = createMiddleware(async (c, next) => {
  const start = performance.now();
  await next();
  const fields = {
    method: c.req.method,
    route: routePath(c),
    status: c.res.status,
    durationMs: Math.round(performance.now() - start),
  };
  if (c.res.status >= 500) logger.error(fields, "request");
  else logger.info(fields, "request");
});
