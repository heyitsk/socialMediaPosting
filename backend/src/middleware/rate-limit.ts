import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { redis } from "../lib/redis";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// In dev every request arrives from Vite's proxy on loopback, so the real
// client is in X-Forwarded-For. Take the right-most non-loopback entry — the
// one appended by the tunnel/reverse proxy itself — never the left-most,
// which the client can set to anything.
function clientIp(c: Context): string {
  const remote = getConnInfo(c).remote.address ?? "unknown";
  if (!LOOPBACK.has(remote)) return remote;

  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter((ip) => ip && !LOOPBACK.has(ip));
  return forwarded.at(-1) ?? remote;
}

// Fixed-window per-IP counter in Redis.
export function rateLimit(name: string, limit: number, windowSeconds: number) {
  return createMiddleware(async (c, next) => {
    const key = `ratelimit:${name}:${clientIp(c)}`;
    const [[, count]] = (await redis.multi().incr(key).expire(key, windowSeconds, "NX").exec()) as [
      [Error | null, number],
    ];
    if (count > limit) {
      throw new HTTPException(429, { message: "Too many requests" });
    }
    await next();
  });
}
