import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { logger } from "hono/logger";
import { env } from "./lib/env";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { facebookAuthRoute } from "./routes/auth/facebook";
import { instagramAuthRoute } from "./routes/auth/instagram";
import { linkedinAuthRoute } from "./routes/auth/linkedin";
import { threadsAuthRoute } from "./routes/auth/threads";
import { youtubeAuthRoute } from "./routes/auth/youtube";
import { healthRoute } from "./routes/health";
import { integrationsRoute } from "./routes/integrations";
import { postsRoute } from "./routes/posts";
import { webhooksRoute } from "./routes/webhooks";
import { startVideoStatusWorker } from "./queue/video-status-worker";

const app = new OpenAPIHono();

app.use(logger());
app.use(corsMiddleware);
app.onError(errorHandler);

app.route("/health", healthRoute);
app.route("/api/auth/facebook", facebookAuthRoute);
app.route("/api/auth/instagram", instagramAuthRoute);
app.route("/api/auth/threads", threadsAuthRoute);
app.route("/api/auth/linkedin", linkedinAuthRoute);
app.route("/api/auth/youtube", youtubeAuthRoute);
app.route("/api/integrations", integrationsRoute);
app.route("/api/posts", postsRoute);
app.route("/api/webhooks", webhooksRoute);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "smPosting API", version: "0.1.0" },
});
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

// Same process as the API for now (no separate worker deployment yet — see
// websitePlan.md Phase 3 queue-mode/K8s roadmap item).
startVideoStatusWorker();

console.log(`smPosting backend listening on ${server.url}`);
console.log(`API docs available at ${server.url}docs`);
