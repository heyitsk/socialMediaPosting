import { z } from "@hono/zod-openapi";
import type {
  ContentKind,
  MediaAssetStatus,
  MediaType,
  Platform,
  PostStatus,
  Prisma,
} from "@prisma/client";
import { friendlyPlatformError } from "../lib/platform-error";

export const platformSchema = z.enum([
  "FACEBOOK",
  "INSTAGRAM",
  "THREADS",
  "YOUTUBE",
  "PINTEREST",
  "LINKEDIN",
]);

export const mediaTypeSchema = z.enum([
  "TEXT",
  "IMAGE",
  "VIDEO",
  "CAROUSEL",
  "REELS",
  "STORIES",
  "SHORTS",
]);

export const contentKindSchema = z.enum(["TEXT", "IMAGE", "CAROUSEL", "VIDEO", "STORY"]);

export const postStatusSchema = z.enum([
  "DRAFT",
  "SCHEDULED",
  "PROCESSING",
  "PUBLISHED",
  "PARTIAL_FAILURE",
  "FAILED",
  "CANCELLED",
]);

// YouTube rejects titles over 100 chars or containing < / > outright, and
// caps all tags combined at ~500 chars — checked here so it's a clear 400
// instead of a FAILED post log with a raw API error.
//
// YouTube's assignable video categories (videoCategories.list, regionCode=US,
// assignable=true). Ids are global but a few regions don't allow every one —
// hardcoded rather than fetched per channel since this list has been stable
// for years; frontend composer.tsx mirrors it with labels.
const YOUTUBE_CATEGORY_IDS = [
  "1",
  "2",
  "10",
  "15",
  "17",
  "19",
  "20",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
] as const;

export const youtubeOptionsSchema = z
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
    status: z.enum(["SUCCESS", "FAILED"]),
    platformPostId: z.string().nullable(),
    errorMessage: z.string().nullable(),
    executedAt: z.iso.datetime(),
  })
  .openapi("PostLog");

const postTargetSchema = z
  .object({
    // The Post id — what retry takes.
    id: z.string(),
    connectedAccountId: z.string(),
    platform: platformSchema,
    accountName: z.string(),
    mediaType: mediaTypeSchema,
    caption: z.string(),
    status: postStatusSchema,
    attempt: z.number(),
    // YouTube targets only — the caption is the video's description, so the
    // title is what History leads with instead.
    youtubeTitle: z.string().nullable(),
    // Oldest first; the last one is the current attempt's outcome.
    logs: z.array(postLogSchema),
  })
  .openapi("PostTarget");

export const postGroupSchema = z
  .object({
    id: z.string(),
    contentKind: contentKindSchema,
    caption: z.string(),
    // Public URLs — only on posts made before S3 uploads; empty otherwise.
    mediaUrls: z.array(z.string()),
    // Uploaded files, in order.
    media: z.array(
      z.object({
        id: z.string(),
        filename: z.string(),
        contentType: z.string(),
        sizeBytes: z.number(),
        // False once the file is removed after the retention period.
        available: z.boolean(),
      }),
    ),
    status: postStatusSchema,
    scheduledFor: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    createdBy: z.object({ name: z.string() }),
    targets: z.array(postTargetSchema),
  })
  .openapi("PostGroup");

export const postGroupInclude = {
  createdBy: { select: { name: true } },
  media: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      originalFilename: true,
      contentType: true,
      sizeBytes: true,
      status: true,
    },
  },
  posts: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      connectedAccount: { select: { platform: true, accountName: true } },
      logs: { orderBy: { executedAt: "asc" } },
    },
  },
} satisfies Prisma.PostGroupInclude;

interface PostGroupRow {
  id: string;
  contentKind: ContentKind;
  caption: string;
  mediaUrls: unknown;
  media: {
    id: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    status: MediaAssetStatus;
  }[];
  status: PostStatus;
  scheduledFor: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  createdBy: { name: string };
  posts: {
    id: string;
    connectedAccountId: string;
    mediaType: MediaType;
    caption: string;
    status: PostStatus;
    attempt: number;
    platformOptions: unknown;
    connectedAccount: { platform: Platform; accountName: string };
    logs: {
      status: "SUCCESS" | "FAILED";
      platformPostId: string | null;
      errorMessage: string | null;
      executedAt: Date;
    }[];
  }[];
}

export function serializePostGroup(group: PostGroupRow): z.infer<typeof postGroupSchema> {
  return {
    id: group.id,
    contentKind: group.contentKind,
    caption: group.caption,
    mediaUrls: group.mediaUrls as string[],
    media: group.media.map((asset) => ({
      id: asset.id,
      filename: asset.originalFilename,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      available: asset.status === "READY",
    })),
    status: group.status,
    scheduledFor: group.scheduledFor?.toISOString() ?? null,
    cancelledAt: group.cancelledAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    createdBy: group.createdBy,
    targets: group.posts.map((post) => ({
      id: post.id,
      connectedAccountId: post.connectedAccountId,
      platform: post.connectedAccount.platform,
      accountName: post.connectedAccount.accountName,
      mediaType: post.mediaType,
      caption: post.caption,
      status: post.status,
      attempt: post.attempt,
      youtubeTitle: (post.platformOptions as { title?: string } | null)?.title ?? null,
      logs: post.logs.map((log) => ({
        status: log.status,
        platformPostId: log.platformPostId,
        errorMessage: log.errorMessage && friendlyPlatformError(log.errorMessage),
        executedAt: log.executedAt.toISOString(),
      })),
    })),
  };
}
