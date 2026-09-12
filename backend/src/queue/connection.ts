import { env } from "../lib/env";

/**
 * Returns a plain connection options object rather than a shared ioredis
 * instance. Confirmed via the Bun spike test (see websitePlan.md §1): passing
 * this to every Queue/Worker/QueueEvents lets BullMQ set maxRetriesPerRequest
 * correctly per client type, and avoids sharing one blocking connection
 * across multiple Worker/QueueEvents instances (BullMQ's own recommendation).
 */
export function redisConnection() {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  };
}
