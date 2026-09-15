import Redis from "ioredis";
import { redisConnection } from "../queue/connection";

// General-purpose client (OAuth CSRF state, later the per-(user,platform)
// rate limiter) — separate from BullMQ's own Queue/Worker connections.
export const redis = new Redis(redisConnection());
