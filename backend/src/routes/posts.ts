import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { Platform } from "@prisma/client";
import { prisma } from "../db/client";
import { getOrCreateDefaultUser } from "../db/users";
import {
  buildFacebookPayload,
  buildInstagramPayload,
  buildLinkedInPayload,
  buildThreadsPayload,
  buildYouTubePayload,
  dispatchInstagramToN8n,
  dispatchLinkedInToN8n,
  dispatchThreadsToN8n,
  dispatchToN8n,
  dispatchYouTubeToN8n,
} from "../service/n8n";

const mediaTypeSchema = z.enum(["TEXT", "IMAGE", "VIDEO", "CAROUSEL", "REELS", "STORIES", "SHORTS"]);

// n8n's per-platform workflows only implement these branches — reject
// anything else before dispatching instead of relying on the workflow's
// fallback "unsupported media_type" error branch.
const SUPPORTED_MEDIA_TYPES: Partial<Record<Platform, readonly string[]>> = {
  FACEBOOK: ["TEXT", "IMAGE", "VIDEO", "CAROUSEL"],
  INSTAGRAM: ["IMAGE", "CAROUSEL", "REELS", "STORIES"],
  THREADS: ["TEXT", "IMAGE", "VIDEO", "CAROUSEL"],
  LINKEDIN: ["TEXT", "IMAGE", "VIDEO", "CAROUSEL"],
  YOUTUBE: ["VIDEO", "SHORTS"],
};

// YouTube rejects titles over 100 chars or containing < / > outright, and
// caps all tags combined at ~500 chars — checked here so it's a clear 400
// instead of a FAILED post log with a raw API error.
//
// YouTube's assignable video categories (videoCategories.list, regionCode=US,
// assignable=true). Ids are global but a few regions don't allow every one —
// hardcoded rather than fetched per channel since this list has been stable
// for years; frontend composer.tsx mirrors it with labels.
const YOUTUBE_CATEGORY_IDS = [
  "1", "2", "10", "15", "17", "19", "20", "22", "23", "24", "25", "26", "27", "28", "29",
] as const;

const youtubeOptionsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((title) => !/[<>]/.test(title), "Title can't contain < or >"),
    // Defaults to private so a test post never goes public by accident —
    // same default youtube-poster.json has always used.
    privacyStatus: z.enum(["public", "unlisted", "private"]).default("private"),
    // COPPA self-declaration — YouTube requires an explicit answer per video.
    madeForKids: z.boolean().default(false),
    // 22 = People & Blogs, youtube-poster.json's old hardcoded value.
    categoryId: z.enum(YOUTUBE_CATEGORY_IDS).default("22"),
    tags: z
      .array(z.string().trim().min(1))
      .default([])
      .refine((tags) => tags.join(",").length <= 500, "Tags can't exceed 500 characters combined"),
  })
  .openapi("YouTubeOptions");

const postLogSchema = z
  .object({
    platform: z.enum(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST", "LINKEDIN"]),
    status: z.enum(["SUCCESS", "FAILED"]),
    platformPostId: z.string().nullable(),
    errorMessage: z.string().nullable(),
    executedAt: z.iso.datetime(),
  })
  .openapi("PostLog");

const postSchema = z
  .object({
    id: z.string(),
    caption: z.string(),
    mediaType: mediaTypeSchema,
    mediaUrls: z.array(z.string()),
    status: z.enum(["DRAFT", "SCHEDULED", "PROCESSING", "PUBLISHED", "PARTIAL_FAILURE", "FAILED"]),
    createdAt: z.iso.datetime(),
    logs: z.array(postLogSchema),
    // YouTube posts only — the caption is the video's description, so the
    // title is what the history page leads with instead.
    youtubeTitle: z.string().nullable(),
    connectedAccount: z.object({
      platform: z.enum(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST", "LINKEDIN"]),
      accountName: z.string(),
    }),
  })
  .openapi("Post");

const createPostSchema = z
  .object({
    connectedAccountId: z.string(),
    caption: z.string().min(1),
    mediaType: mediaTypeSchema,
    mediaUrls: z.array(z.string().url()).default([]),
    // Required when connectedAccountId is a YouTube channel, ignored otherwise.
    youtubeOptions: youtubeOptionsSchema.optional(),
  })
  .openapi("CreatePostRequest");

const listPosts = createRoute({
  method: "get",
  path: "/",
  tags: ["Posts"],
  summary: "List posts with their dispatch logs",
  responses: {
    200: {
      description: "Posts for the current user",
      content: { "application/json": { schema: z.array(postSchema) } },
    },
  },
});

const createPost = createRoute({
  method: "post",
  path: "/",
  tags: ["Posts"],
  summary: "Create a post and immediately dispatch it to n8n",
  request: {
    body: { content: { "application/json": { schema: createPostSchema } } },
  },
  responses: {
    201: {
      description: "Post created and dispatch attempted",
      content: { "application/json": { schema: postSchema } },
    },
  },
});

function serializePost({ platformOptions, ...post }: {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrls: unknown;
  status: string;
  createdAt: Date;
  platformOptions: unknown;
  logs: {
    platform: string;
    status: string;
    platformPostId: string | null;
    errorMessage: string | null;
    executedAt: Date;
  }[];
  connectedAccount: { platform: string; accountName: string };
}) {
  return {
    ...post,
    mediaType: post.mediaType as z.infer<typeof mediaTypeSchema>,
    mediaUrls: post.mediaUrls as string[],
    status: post.status as z.infer<typeof postSchema>["status"],
    createdAt: post.createdAt.toISOString(),
    youtubeTitle: (platformOptions as { title?: string } | null)?.title ?? null,
    logs: post.logs.map((log) => ({
      ...log,
      platform: log.platform as z.infer<typeof postLogSchema>["platform"],
      status: log.status as z.infer<typeof postLogSchema>["status"],
      executedAt: log.executedAt.toISOString(),
    })),
    connectedAccount: {
      platform: post.connectedAccount.platform as z.infer<typeof postSchema>["connectedAccount"]["platform"],
      accountName: post.connectedAccount.accountName,
    },
  };
}

export const postsRoute = new OpenAPIHono()
  .openapi(listPosts, async (c) => {
    const user = await getOrCreateDefaultUser();
    const posts = await prisma.post.findMany({
      where: { userId: user.id },
      include: { logs: true, connectedAccount: { select: { platform: true, accountName: true } } },
      orderBy: { createdAt: "desc" },
    });

    return c.json(posts.map(serializePost), 200);
  })
  .openapi(createPost, async (c) => {
    const body = c.req.valid("json");
    const user = await getOrCreateDefaultUser();

    const connectedAccount = await prisma.connectedAccount.findFirst({
      where: { id: body.connectedAccountId, userId: user.id, disconnectedAt: null },
    });

    if (!connectedAccount) {
      throw new HTTPException(404, { message: "Connected account not found" });
    }

    const supportedMediaTypes = SUPPORTED_MEDIA_TYPES[connectedAccount.platform];
    if (!supportedMediaTypes) {
      throw new HTTPException(400, { message: `${connectedAccount.platform} accounts can't be dispatched yet` });
    }
    if (!supportedMediaTypes.includes(body.mediaType)) {
      throw new HTTPException(400, {
        message: `${connectedAccount.platform} doesn't support media type ${body.mediaType}`,
      });
    }
    if (connectedAccount.platform === "YOUTUBE" && !body.youtubeOptions) {
      throw new HTTPException(400, { message: "YouTube posts need youtubeOptions.title" });
    }

    const post = await prisma.post.create({
      data: {
        userId: user.id,
        connectedAccountId: connectedAccount.id,
        caption: body.caption,
        mediaType: body.mediaType,
        mediaUrls: body.mediaUrls,
        platformOptions: connectedAccount.platform === "YOUTUBE" ? body.youtubeOptions : undefined,
        status: "PROCESSING",
      },
    });

    try {
      if (connectedAccount.platform === "FACEBOOK") {
        await dispatchToN8n(buildFacebookPayload(post, connectedAccount));
      } else if (connectedAccount.platform === "INSTAGRAM") {
        await dispatchInstagramToN8n(buildInstagramPayload(post, connectedAccount));
      } else if (connectedAccount.platform === "LINKEDIN") {
        await dispatchLinkedInToN8n(buildLinkedInPayload(post, connectedAccount));
      } else if (connectedAccount.platform === "YOUTUBE") {
        await dispatchYouTubeToN8n(await buildYouTubePayload(post, connectedAccount));
      } else {
        await dispatchThreadsToN8n(buildThreadsPayload(post, connectedAccount));
      }
    } catch (err) {
      console.error("n8n dispatch failed:", err);
      await prisma.post.update({ where: { id: post.id }, data: { status: "FAILED" } });
      await prisma.postLog.create({
        data: {
          postId: post.id,
          platform: connectedAccount.platform,
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "n8n dispatch failed",
        },
      });
    }

    const finalPost = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { logs: true, connectedAccount: { select: { platform: true, accountName: true } } },
    });

    return c.json(serializePost(finalPost), 201);
  });
