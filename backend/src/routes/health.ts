import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime(),
  })
  .openapi("HealthResponse");

const getHealth = createRoute({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "Liveness check",
  responses: {
    200: {
      description: "Backend is up",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});

export const healthRoute = new OpenAPIHono().openapi(getHealth, (c) => {
  return c.json({ status: "ok" as const, timestamp: new Date().toISOString() });
});
