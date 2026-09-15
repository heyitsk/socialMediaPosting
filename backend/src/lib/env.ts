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

  DEFAULT_USER_EMAIL: z.string().email(),
  DEFAULT_USER_NAME: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  throw new Error("Invalid environment variables — check .env against .env.example");
}

export const env = parsed.data;
