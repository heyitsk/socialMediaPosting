import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.url(),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6380),
  TOKEN_ENCRYPTION_KEY_V1: z.string().min(1, "TOKEN_ENCRYPTION_KEY_V1 is required (32 random bytes, base64)"),
  FRONTEND_URL: z.url().default("http://localhost:5173"),

  PUBLIC_BACKEND_URL: z.url(),
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_GRAPH_VERSION: z.string().default("v21.0"),

  // Separate from META_APP_ID/SECRET — issued when the "Instagram API setup
  // with Instagram Login" product is added to the Meta App, used for
  // standalone Instagram accounts with no linked Facebook Page.
  INSTAGRAM_APP_ID: z.string().min(1),
  INSTAGRAM_APP_SECRET: z.string().min(1),

  // Issued by the "Threads API" product on the same Meta App as
  // META_APP_ID/SECRET — separate credentials, separate OAuth dialog
  // (threads.net, not facebook.com). See lib/threads.ts.
  THREADS_APP_ID: z.string().min(1),
  THREADS_APP_SECRET: z.string().min(1),

  // From a standalone LinkedIn App (developer.linkedin.com), not a Meta App —
  // "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn"
  // products. See lib/linkedin.ts.
  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),

  DEFAULT_USER_EMAIL: z.string().email(),
  DEFAULT_USER_NAME: z.string().min(1),

  N8N_BASE_URL: z.url(),
  N8N_CALLBACK_SECRET: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment variables — check .env against .env.example");
}

export const env = parsed.data;
