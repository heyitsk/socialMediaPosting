import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { MediaAsset } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { prisma } from "../db/client";
import { logger } from "../lib/logger";
import {
  contentMatches,
  isVideoType,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_CONTENT_TYPES,
  type MediaContentType,
  maxBytesFor,
  mediaKey,
} from "../lib/media-files";
import {
  completeMultipartUpload,
  headObject,
  presignImageUpload,
  readObjectHead,
  startMultipartUpload,
} from "../lib/s3";
import type { WorkspaceEnv } from "../middleware/auth";
import { rateLimitByUser } from "../middleware/rate-limit";
import { deleteMediaAsset, probeMediaAsset } from "../service/media";
import { workspaceParamsSchema } from "./workspace-params";

// Composer uploads straight to S3 (websitePlan.md §11), in two phases:
// 1. POST /media — we record a PENDING asset and hand back presigned upload
//    URLs (one form POST for an image, one PUT per part for a video).
// 2. POST /media/:id/complete — we check the object S3 actually has (size,
//    magic bytes), read its dimensions and mark it READY. Only READY assets
//    can be posted.
// Anything left PENDING or never posted is removed by the media cleaner.

const contentTypeSchema = z.enum(MEDIA_CONTENT_TYPES);

export const mediaAssetSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
    status: z.enum(["PENDING", "READY", "DELETED"]),
    // As displayed; null until the upload completes.
    width: z.number().nullable(),
    height: z.number().nullable(),
    // Videos only.
    durationSeconds: z.number().nullable(),
  })
  .openapi("MediaAsset");

const createUploadSchema = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: contentTypeSchema,
    sizeBytes: z.number().int().positive(),
  })
  .openapi("CreateMediaUploadRequest");

const uploadSchema = z
  .discriminatedUnion("method", [
    // multipart/form-data POST to url: every field, then the file last.
    z.object({
      method: z.literal("POST"),
      url: z.string(),
      fields: z.record(z.string(), z.string()),
    }),
    // PUT each partSize slice of the file to its url, then send each
    // response's ETag header to /complete.
    z.object({
      method: z.literal("MULTIPART"),
      partSize: z.number(),
      parts: z.array(z.object({ partNumber: z.number(), url: z.string() })),
    }),
  ])
  .openapi("MediaUploadInstructions");

const completeUploadSchema = z
  .object({
    // Videos only.
    parts: z
      .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
      .optional(),
  })
  .openapi("CompleteMediaUploadRequest");

const assetParamsSchema = workspaceParamsSchema.extend({ assetId: z.string() });

const createUpload = createRoute({
  method: "post",
  path: "/",
  tags: ["Media"],
  summary: "Start uploading a file for the composer",
  description: `JPEG/PNG/WebP images up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB, MP4/MOV videos up to ${MAX_VIDEO_BYTES / 1024 / 1024 / 1024} GB. Limited to 120 per 10 minutes per user.`,
  middleware: [rateLimitByUser("media-upload", 120, 10 * 60)] as const,
  request: {
    params: workspaceParamsSchema,
    body: { content: { "application/json": { schema: createUploadSchema } } },
  },
  responses: {
    201: {
      description: "Upload the file with these instructions, then call /complete",
      content: {
        "application/json": {
          schema: z.object({ asset: mediaAssetSchema, upload: uploadSchema }),
        },
      },
    },
    400: { description: "File too large or not an accepted type" },
  },
});

const completeUpload = createRoute({
  method: "post",
  path: "/{assetId}/complete",
  tags: ["Media"],
  summary: "Confirm an upload finished — checks what S3 received",
  request: {
    params: assetParamsSchema,
    body: { content: { "application/json": { schema: completeUploadSchema } } },
  },
  responses: {
    200: {
      description: "The asset, READY to post",
      content: { "application/json": { schema: mediaAssetSchema } },
    },
    400: { description: "Upload incomplete, or the file isn't what it claimed to be" },
    404: { description: "Not found" },
  },
});

const deleteUpload = createRoute({
  method: "delete",
  path: "/{assetId}",
  tags: ["Media"],
  summary: "Remove a file from the composer before posting",
  request: { params: assetParamsSchema },
  responses: {
    204: { description: "Removed" },
    404: { description: "Not found" },
    409: { description: "Already part of a post" },
  },
});

function serializeAsset(asset: MediaAsset): z.infer<typeof mediaAssetSchema> {
  return {
    id: asset.id,
    filename: asset.originalFilename,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
  };
}

async function findAsset(workspaceId: string, assetId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, workspaceId } });
  if (!asset || asset.status === "DELETED") {
    throw new HTTPException(404, { message: "File not found — upload it again" });
  }
  return asset;
}

// Deletes what was uploaded and tells the composer why.
async function reject(asset: MediaAsset, message: string): Promise<never> {
  await deleteMediaAsset(asset);
  throw new HTTPException(400, { message });
}

function describe(contentType: string): string {
  return contentType.split("/")[1]?.toUpperCase().replace("QUICKTIME", "MOV") ?? contentType;
}

export const mediaRoute = new OpenAPIHono<WorkspaceEnv>()
  .openapi(createUpload, async (c) => {
    const { filename, contentType, sizeBytes } = c.req.valid("json");
    const { workspaceId, userId } = c.var;

    const maxBytes = maxBytesFor(contentType);
    if (sizeBytes > maxBytes) {
      throw new HTTPException(400, {
        message: `${isVideoType(contentType) ? "Videos" : "Images"} can be at most ${maxBytes / 1024 / 1024} MB`,
      });
    }

    const id = crypto.randomUUID();
    const key = mediaKey(workspaceId, id, contentType);
    const video = isVideoType(contentType);
    const multipart = video ? await startMultipartUpload(key, contentType, sizeBytes) : null;

    const asset = await prisma.mediaAsset.create({
      data: {
        id,
        workspaceId,
        uploadedByUserId: userId,
        key,
        originalFilename: filename,
        contentType,
        sizeBytes,
        multipartUploadId: multipart?.uploadId,
      },
    });

    const upload: z.infer<typeof uploadSchema> = multipart
      ? { method: "MULTIPART", partSize: multipart.partSize, parts: multipart.parts }
      : { method: "POST", ...(await presignImageUpload(key, contentType, sizeBytes)) };
    return c.json({ asset: serializeAsset(asset), upload }, 201);
  })
  .openapi(completeUpload, async (c) => {
    const { assetId } = c.req.valid("param");
    const { parts } = c.req.valid("json");
    const asset = await findAsset(c.var.workspaceId, assetId);
    // A retried /complete after a lost response.
    if (asset.status === "READY") return c.json(serializeAsset(asset), 200);

    if (asset.multipartUploadId) {
      if (!parts || parts.length === 0) {
        throw new HTTPException(400, { message: "Video uploads need their parts' ETags" });
      }
      try {
        await completeMultipartUpload(asset.key, asset.multipartUploadId, parts);
      } catch (err) {
        // Missing/wrong parts (InvalidPart, InvalidPartOrder, EntityTooSmall):
        // the client can re-send them before the URLs expire.
        logger.warn({ mediaId: asset.id, err }, "completing multipart upload failed");
        throw new HTTPException(400, {
          message: "The upload didn't finish — some parts are missing. Try again",
        });
      }
    }

    const stored = await headObject(asset.key);
    if (!stored) {
      throw new HTTPException(400, { message: "The upload didn't finish — try again" });
    }
    if (stored.sizeBytes !== asset.sizeBytes) {
      await reject(asset, "The uploaded file isn't the size it said it was — upload it again");
    }
    const contentType = asset.contentType as MediaContentType;
    if (!contentMatches(contentType, await readObjectHead(asset.key))) {
      await reject(
        asset,
        `${asset.originalFilename} isn't really a ${describe(contentType)} file (iPhone photos are often HEIC — export as JPEG)`,
      );
    }

    // For the per-platform aspect-ratio checks (websitePlan.md §12). A file
    // we can't measure is one the platforms can't read either.
    const shape = await probeMediaAsset(asset).catch((err: unknown) => {
      logger.warn({ mediaId: asset.id, err }, "probing media failed");
      return null;
    });
    if (!shape) {
      await reject(
        asset,
        `${asset.originalFilename} couldn't be read — it may be damaged. Export it again and re-upload`,
      );
    }

    const ready = await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        completedAt: new Date(),
        multipartUploadId: null,
        width: shape?.width,
        height: shape?.height,
        durationSeconds: shape?.durationSeconds,
      },
    });
    return c.json(serializeAsset(ready), 200);
  })
  .openapi(deleteUpload, async (c) => {
    const { assetId } = c.req.valid("param");
    const asset = await findAsset(c.var.workspaceId, assetId);
    if (asset.groupId) {
      throw new HTTPException(409, { message: "This file is part of a post and can't be removed" });
    }
    if (!(await deleteMediaAsset(asset))) {
      throw new HTTPException(502, { message: "Couldn't remove the file — try again" });
    }
    return c.body(null, 204);
  });
