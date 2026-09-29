import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  CAPTION_LIMITS,
  CAROUSEL_LIMITS,
  CONTENT_KINDS,
  INSTAGRAM_MAX_HASHTAGS,
  MEDIA_TYPES,
  POSTABLE_PLATFORMS,
  SHORTS_MAX_DURATION_SECONDS,
} from "../lib/capabilities";
import type { AuthEnv } from "../middleware/auth";
import { contentKindSchema, mediaTypeSchema, platformSchema } from "./post-schemas";

const capabilitiesSchema = z
  .object({
    platforms: z.array(
      z.object({
        platform: platformSchema,
        captionLimit: z.number(),
        carousel: z.object({ min: z.number(), max: z.number() }),
        // Only the kinds this platform supports; the first media type is the default.
        mediaTypes: z.array(
          z.object({ kind: contentKindSchema, mediaTypes: z.array(mediaTypeSchema) }),
        ),
      }),
    ),
    instagramMaxHashtags: z.number(),
    shortsMaxDurationSeconds: z.number(),
  })
  .openapi("Capabilities");

const getCapabilities = createRoute({
  method: "get",
  path: "/",
  tags: ["Posts"],
  summary: "What each platform can post, and its limits",
  responses: {
    200: {
      description: "Per-platform capabilities",
      content: { "application/json": { schema: capabilitiesSchema } },
    },
  },
});

export const capabilitiesRoute = new OpenAPIHono<AuthEnv>().openapi(getCapabilities, (c) =>
  c.json(
    {
      platforms: POSTABLE_PLATFORMS.map((platform) => ({
        platform,
        captionLimit: CAPTION_LIMITS[platform],
        carousel: CAROUSEL_LIMITS[platform],
        mediaTypes: CONTENT_KINDS.flatMap((kind) => {
          const mediaTypes = MEDIA_TYPES[platform][kind];
          return mediaTypes ? [{ kind, mediaTypes: [...mediaTypes] }] : [];
        }),
      })),
      instagramMaxHashtags: INSTAGRAM_MAX_HASHTAGS,
      shortsMaxDurationSeconds: SHORTS_MAX_DURATION_SECONDS,
    },
    200,
  ),
);
