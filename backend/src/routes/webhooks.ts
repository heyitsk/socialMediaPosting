import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Platform } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { env } from "../lib/env";
import { enqueueVideoStatusPoll } from "../queue/video-status-queue";

const PLATFORM_VALUES = ["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST", "LINKEDIN"] as const;

const n8nCallbackSchema = z
  .object({
    post_id: z.string(),
    platform: z.string(),
    status: z.enum(["SUCCESS", "FAILED"]),
    platform_post_id: z.string().nullable().optional(),
    // Only sent by linkedin-poster.json's VIDEO branch — the video's own
    // urn:li:video:... isn't the same thing as platform_post_id (the created
    // post/share's urn), so it travels as a separate field. See
    // "LinkedIn video: poll before marking PUBLISHED" below.
    media_urn: z.string().nullable().optional(),
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

  // Facebook video: POST /{page_id}/videos accepts the upload and returns an
  // id immediately, but the video is still transcoding — don't mark PUBLISHED
  // until a background poller confirms video_status is actually "ready"
  // (websitePlan.md §6 "Async Media Processing Poller").
  //
  // LinkedIn video: linkedin-poster.json already blind-waits 30s and only
  // calls this callback after LI Publish Video succeeds, so the post exists
  // by now — same as Facebook's case, the underlying video can still fail
  // processing after that (CORRUPTED_ENTITY etc.), so poll GET
  // /rest/videos/{urn} before trusting it enough to show "Published" on the
  // history page. Polls media_urn (the video's own urn:li:video:...), logs
  // platform_post_id (the created post's urn:li:share:...) once confirmed.
  if (
    (platform === "FACEBOOK" || platform === "LINKEDIN") &&
    body.status === "SUCCESS" &&
    body.platform_post_id
  ) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: body.post_id } });
    if (post.mediaType === "VIDEO") {
      const mediaId = platform === "LINKEDIN" ? (body.media_urn ?? body.platform_post_id) : body.platform_post_id;
      await enqueueVideoStatusPoll(body.post_id, platform, body.platform_post_id, mediaId);
      return c.body(null, 204);
    }
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
