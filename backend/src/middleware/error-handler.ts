import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../lib/logger";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  // @hono/otel already records the exception on the request span.
  logger.error({ err }, "unhandled error");
  return c.json({ error: "Internal Server Error" }, 500);
};
