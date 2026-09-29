import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { type MediaContentType, partSizeFor, SNIFF_BYTES } from "./media-files";

// The media bucket is private: the browser uploads with presigned URLs and
// n8n downloads with presigned GETs — bytes never pass through this server.
// websitePlan.md §11.
//
// Uses the AWS SDK rather than Bun's native S3 client because it can sign a
// POST policy (S3 itself enforces the upload's exact size and type) and
// per-part multipart URLs.
//
// Recent SDK versions add a CRC32 checksum to every request by default; in a
// presigned URL that's a checksum of an empty body, which S3 then rejects
// against the real upload. Only send checksums when an operation needs them.
export const s3 = new S3Client({
  region: env.AWS_REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const Bucket = env.S3_MEDIA_BUCKET;

// Long enough for a 1 GB video on a slow connection. A URL signed with
// temporary credentials (dev `aws login`) also dies when they expire.
const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;

// Images: one form POST. The policy pins the exact size and type the
// composer declared, so S3 rejects anything else without our involvement.
export async function presignImageUpload(
  key: string,
  contentType: MediaContentType,
  sizeBytes: number,
) {
  return createPresignedPost(s3, {
    Bucket,
    Key: key,
    Expires: UPLOAD_URL_TTL_SECONDS,
    Conditions: [
      ["content-length-range", sizeBytes, sizeBytes],
      ["eq", "$Content-Type", contentType],
    ],
    Fields: { "Content-Type": contentType },
  });
}

// Videos: a multipart upload with one presigned PUT per part. Part URLs
// can't pin a size, so completeUpload checks the assembled object instead.
export async function startMultipartUpload(
  key: string,
  contentType: MediaContentType,
  sizeBytes: number,
) {
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
  );
  if (!UploadId) throw new Error("S3 didn't return an upload id");

  const partSize = partSizeFor(sizeBytes);
  const partCount = Math.ceil(sizeBytes / partSize);
  const parts = await Promise.all(
    Array.from({ length: partCount }, async (_, index) => ({
      partNumber: index + 1,
      url: await getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket, Key: key, UploadId, PartNumber: index + 1 }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS },
      ),
    })),
  );
  return { uploadId: UploadId, partSize, parts };
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
) {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
}

// Size and stored type of an uploaded object, or null if it isn't there.
export async function headObject(key: string) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType ?? "" };
  } catch (err) {
    if (err instanceof Error && err.name === "NotFound") return null;
    throw err;
  }
}

// The first few bytes, for the magic-byte check in lib/media-files.ts.
export async function readObjectHead(key: string): Promise<Uint8Array> {
  const { Body } = await s3.send(
    new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${SNIFF_BYTES - 1}` }),
  );
  if (!Body) return new Uint8Array();
  return Body.transformToByteArray();
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

// A read link for n8n/the platforms (or ffprobe). The URL is the only thing
// that grants access, so keep it short-lived.
export async function presignDownload(key: string, expiresInSeconds: number) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
