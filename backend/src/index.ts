import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { logger } from "hono/logger";
import { env } from "./lib/env";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { healthRoute } from "./routes/health";

const app = new OpenAPIHono();

app.use(logger());
app.use(corsMiddleware);
app.onError(errorHandler);

app.route("/health", healthRoute);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "smPosting API", version: "0.1.0" },
});
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

console.log(`smPosting backend listening on ${server.url}`);
console.log(`API docs available at ${server.url}docs`);
