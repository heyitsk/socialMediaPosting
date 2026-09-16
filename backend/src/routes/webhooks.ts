import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Platform } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { env } from "../lib/env";

const PLATFORM_VALUES = ["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST"] as const;

const n8nCallbackSchema = z
  .object({
    post_id: z.string(),
    platform: z.string(),
    status: z.enum(["SUCCESS", "FAILED"]),
    platform_post_id: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .openapi("N8nCallback");

const n8nCallback = createRoute({
  method: "post",
  path: "/n8n-callback",
  tags: ["Webhooks"],
  summary: "Receives per-platform post results from n8n",
  request: {
    body: { content: { "application/json": { schema: n8nCallbackSchema } } },
  },
  responses: {
    204: { description: "Callback processed" },
    401: { description: "Invalid or missing callback secret" },
  },
});

export const webhooksRoute = new OpenAPIHono().openapi(n8nCallback, async (c) => {
  const secret = c.req.header("x-callback-secret");
  if (!secret || secret !== env.N8N_CALLBACK_SECRET) {
    throw new HTTPException(401, { message: "Invalid callback secret" });
  }

  const body = c.req.valid("json");
  const platform = body.platform.toUpperCase();
  if (!PLATFORM_VALUES.includes(platform as (typeof PLATFORM_VALUES)[number])) {
    throw new HTTPException(400, { message: `Unknown platform: ${body.platform}` });
  }

  await prisma.postLog.create({
    data: {
      postId: body.post_id,
      platform: platform as Platform,
      status: body.status,
      platformPostId: body.platform_post_id ?? null,
      errorMessage: body.error ?? null,
    },
  });

  await prisma.post.update({
    where: { id: body.post_id },
    data: { status: body.status === "SUCCESS" ? "PUBLISHED" : "FAILED" },
  });

  return c.body(null, 204);
});
