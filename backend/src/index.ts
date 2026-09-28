import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import { env } from "./lib/env";
import { requireAuth, requireWorkspace } from "./middleware/auth";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { rateLimit } from "./middleware/rate-limit";
import { startPublishWorker, startScheduleReconciler } from "./queue/publish-worker";
import { startVideoStatusWorker } from "./queue/video-status-worker";
import { facebookAuthRoute } from "./routes/auth/facebook";
import { instagramAuthRoute } from "./routes/auth/instagram";
import { linkedinAuthRoute } from "./routes/auth/linkedin";
import { threadsAuthRoute } from "./routes/auth/threads";
import { youtubeAuthRoute } from "./routes/auth/youtube";
import { capabilitiesRoute } from "./routes/capabilities";
import { healthRoute } from "./routes/health";
import { integrationsRoute } from "./routes/integrations";
import { invitesRoute } from "./routes/invites";
import { loginRoute } from "./routes/login";
import { membersRoute } from "./routes/members";
import { postGroupsRoute } from "./routes/post-groups";
import { sessionRoute } from "./routes/session";
import { webhooksRoute } from "./routes/webhooks";
import { workspaceRoute, workspacesRoute } from "./routes/workspaces";

const app = new OpenAPIHono();

app.use(logger());
app.use(corsMiddleware);
// Rejects cross-site form/text POSTs (the only kind that skip a CORS
// preflight) whose Origin isn't the frontend — covers logout and anything
// else that takes a session cookie. JSON requests are already preflighted.
app.use("/api/*", csrf({ origin: env.FRONTEND_URL }));
app.onError(errorHandler);

// Access rules (websitePlan.md §9.5):
// - public: /health, /api/login/* (rate-limited), /api/webhooks/* (n8n,
//   guarded by N8N_CALLBACK_SECRET)
// - session only: /api/me, /api/logout-all (requireAuth inside sessionRoute),
//   /api/capabilities;
//   /api/auth/* connect flows check the session + membership themselves,
//   since they're browser navigations that must redirect, not 401
// - session + membership: everything under /api/workspaces/:workspaceId/*
//   and the bare /api/workspaces/:workspaceId (rename/delete) — Hono's
//   trailing /* also matches the path without it. Owner/admin checks are
//   per-route requireRole().
// - session only: POST /api/workspaces (create) checks it itself
app.route("/health", healthRoute);
app.use("/api/login/*", rateLimit("login", 20, 60));
app.route("/api/login", loginRoute);
app.route("/api", sessionRoute);
app.route("/api/auth/facebook", facebookAuthRoute);
app.route("/api/auth/instagram", instagramAuthRoute);
app.route("/api/auth/threads", threadsAuthRoute);
app.route("/api/auth/linkedin", linkedinAuthRoute);
app.route("/api/auth/youtube", youtubeAuthRoute);
app.use("/api/capabilities", requireAuth);
app.route("/api/capabilities", capabilitiesRoute);
app.route("/api/workspaces", workspacesRoute);
app.use("/api/workspaces/:workspaceId/*", requireAuth, requireWorkspace);
app.route("/api/workspaces/:workspaceId", workspaceRoute);
app.route("/api/workspaces/:workspaceId/members", membersRoute);
app.route("/api/workspaces/:workspaceId/invites", invitesRoute);
app.route("/api/workspaces/:workspaceId/integrations", integrationsRoute);
app.route("/api/workspaces/:workspaceId/post-groups", postGroupsRoute);
app.route("/api/webhooks", webhooksRoute);

// The full API map is no business of the public internet — dev only.
if (env.NODE_ENV !== "production") {
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "smPosting API", version: "0.1.0" },
  });
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));
}

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

// Same process as the API for now (no separate worker deployment yet — see
// websitePlan.md Phase 3 queue-mode/K8s roadmap item).
startVideoStatusWorker();
startPublishWorker();
startScheduleReconciler();

console.log(`smPosting backend listening on ${server.url}`);
if (env.NODE_ENV !== "production") {
  console.log(`API docs available at ${server.url}docs`);
}
