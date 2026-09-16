import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { getOrCreateDefaultUser } from "../db/users";
import { buildFacebookPayload, dispatchToN8n } from "../service/n8n";

const mediaTypeSchema = z.enum(["TEXT", "IMAGE", "VIDEO", "CAROUSEL"]);

const postLogSchema = z
  .object({
    platform: z.enum(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE", "PINTEREST"]),
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
  })
  .openapi("Post");

const createPostSchema = z
  .object({
    connectedAccountId: z.string(),
    caption: z.string().min(1),
    mediaType: mediaTypeSchema,
    mediaUrls: z.array(z.string().url()).default([]),
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

function serializePost(post: {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrls: unknown;
  status: string;
  createdAt: Date;
  logs: {
    platform: string;
    status: string;
    platformPostId: string | null;
    errorMessage: string | null;
    executedAt: Date;
  }[];
}) {
  return {
    ...post,
    mediaType: post.mediaType as z.infer<typeof mediaTypeSchema>,
    mediaUrls: post.mediaUrls as string[],
    status: post.status as z.infer<typeof postSchema>["status"],
    createdAt: post.createdAt.toISOString(),
    logs: post.logs.map((log) => ({
      ...log,
      platform: log.platform as z.infer<typeof postLogSchema>["platform"],
      status: log.status as z.infer<typeof postLogSchema>["status"],
      executedAt: log.executedAt.toISOString(),
    })),
  };
}

export const postsRoute = new OpenAPIHono()
  .openapi(listPosts, async (c) => {
    const user = await getOrCreateDefaultUser();
    const posts = await prisma.post.findMany({
      where: { userId: user.id },
      include: { logs: true },
      orderBy: { createdAt: "desc" },
    });

    return c.json(posts.map(serializePost), 200);
  })
  .openapi(createPost, async (c) => {
    const body = c.req.valid("json");
    const user = await getOrCreateDefaultUser();

    const connectedAccount = await prisma.connectedAccount.findFirst({
      where: { id: body.connectedAccountId, userId: user.id },
    });

    if (!connectedAccount) {
      throw new HTTPException(404, { message: "Connected account not found" });
    }
    if (connectedAccount.platform !== "FACEBOOK") {
      throw new HTTPException(400, { message: "Only Facebook accounts can be dispatched right now" });
    }

    const post = await prisma.post.create({
      data: {
        userId: user.id,
        connectedAccountId: connectedAccount.id,
        caption: body.caption,
        mediaType: body.mediaType,
        mediaUrls: body.mediaUrls,
        status: "PROCESSING",
      },
    });

    try {
      const payload = buildFacebookPayload(post, connectedAccount);
      await dispatchToN8n(payload);
    } catch (err) {
      console.error("n8n dispatch failed:", err);
      await prisma.post.update({ where: { id: post.id }, data: { status: "FAILED" } });
      await prisma.postLog.create({
        data: {
          postId: post.id,
          platform: "FACEBOOK",
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "n8n dispatch failed",
        },
      });
    }

    const finalPost = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { logs: true },
    });

    return c.json(serializePost(finalPost), 201);
  });
