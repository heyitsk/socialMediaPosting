import { cors } from "hono/cors";
import { env } from "../lib/env";

export const corsMiddleware = cors({
  origin: env.FRONTEND_URL,
  credentials: true,
});
