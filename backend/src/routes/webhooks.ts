import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Platform } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { isPostablePlatform } from "../lib/capabilities";
import { env } from "../lib/env";
import { enqueueVideoStatusPoll } from "../queue/video-status-queue";
import { pauseForLimitError } from "../service/limit-pauses";
import { markTargetFailed, markTargetPublished } from "../service/post-groups";

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
    204: { description: "Callback processed (a duplicate is a no-op)" },
    401: { description: "Invalid or missing callback secret" },
    404: { description: "Unknown post_id" },
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
  //
  // YouTube: every post is a video (VIDEO or SHORTS), and youtube-poster.json
  // calls back as soon as the upload PUT finishes — uploadStatus is still
  // "uploaded", not "processed", and YouTube can still reject it (duplicate,
  // copyright, etc.), so it always goes through the same poller.
  const post = await prisma.post.findUnique({
    where: { id: body.post_id },
    select: { mediaType: true, connectedAccount: { select: { platformAccountId: true } } },
  });
  if (!post) {
    throw new HTTPException(404, { message: "Unknown post_id" });
  }

  if (
    (platform === "FACEBOOK" || platform === "LINKEDIN" || platform === "YOUTUBE") &&
    body.status === "SUCCESS" &&
    body.platform_post_id
  ) {
    if (platform === "YOUTUBE" || post.mediaType === "VIDEO") {
      const mediaId = platform === "LINKEDIN" ? (body.media_urn ?? body.platform_post_id) : body.platform_post_id;
      await enqueueVideoStatusPoll(body.post_id, platform, body.platform_post_id, mediaId);
      return c.body(null, 204);
    }
  }

  // Both are no-ops when they don't apply (duplicate callback, target already
  // final) — see service/post-groups.ts.
  if (body.status === "SUCCESS") {
    await markTargetPublished(body.post_id, platform as Platform, body.platform_post_id ?? null);
  } else {
    await markTargetFailed(body.post_id, platform as Platform, body.error ?? "Posting failed", {
      platformPostId: body.platform_post_id,
    });
    // A limit or spam error pauses the account and fails what's waiting for
    // it (websitePlan.md §13.7). Also for a duplicate or late callback — the
    // error is real either way, and a pause is never shortened. A problem
    // here mustn't turn the callback into a 500.
    const failedOn = platform as Platform;
    if (body.error && isPostablePlatform(failedOn)) {
      await pauseForLimitError({
        platform: failedOn,
        platformAccountId: post.connectedAccount.platformAccountId,
        raw: body.error,
        sourcePostId: body.post_id,
      }).catch((err: unknown) => console.error(`couldn't pause after ${body.post_id}:`, err));
    }
  }

  return c.body(null, 204);
});
