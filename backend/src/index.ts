// Must stay first: starts OpenTelemetry before @prisma/client loads.
import "./otel";
import { app } from "./app";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { startPublishWorker, startScheduleReconciler } from "./queue/publish-worker";
import { startRenderReconciler, startRenderWorker } from "./queue/render-worker";
import { startVideoStatusWorker } from "./queue/video-status-worker";
import { startMediaCleaner } from "./service/media";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

// Same process as the API for now (no separate worker deployment yet — see
// websitePlan.md Phase 3 queue-mode/K8s roadmap item).
startVideoStatusWorker();
startPublishWorker();
startScheduleReconciler();
startRenderWorker();
startRenderReconciler();
startMediaCleaner();

logger.info({ url: server.url.href }, "smPosting backend listening");
if (env.NODE_ENV !== "production") {
  logger.info({ url: `${server.url}docs` }, "API docs available");
}
