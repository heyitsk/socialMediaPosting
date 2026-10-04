import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { redis } from "../lib/redis";
import type { AuthEnv } from "./auth";

// Addresses a reverse proxy we run ourselves can connect from: loopback
// (Vite's proxy in dev) or a private range (Caddy on the Docker network in
// production). The public internet never reaches the backend from these.
function isProxyHop(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (v4 === "::1" || v4.startsWith("127.") || v4.startsWith("10.")) return true;
  if (v4.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true;
  return /^f[cd]/i.test(v4); // IPv6 unique-local, Docker's IPv6 networks
}

// Behind a proxy the real client is in X-Forwarded-For. Take the right-most
// entry that isn't one of our proxies — the one the proxy itself appended —
// never the left-most, which the client can set to anything.
function clientIp(c: Context): string {
  const remote = getConnInfo(c).remote.address ?? "unknown";
  if (!isProxyHop(remote)) return remote;

  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter((ip) => ip && !isProxyHop(ip));
  return forwarded.at(-1) ?? remote;
}

// Fixed-window counter in Redis.
async function hit(key: string, limit: number, windowSeconds: number) {
  const [[, count]] = (await redis.multi().incr(key).expire(key, windowSeconds, "NX").exec()) as [
    [Error | null, number],
  ];
  if (count > limit) {
    throw new HTTPException(429, { message: "Too many requests" });
  }
}

export function rateLimit(name: string, limit: number, windowSeconds: number) {
  return createMiddleware(async (c, next) => {
    await hit(`ratelimit:${name}:${clientIp(c)}`, limit, windowSeconds);
    await next();
  });
}

// Per signed-in user rather than per IP, for actions one user could spread
// across many IPs (invites). Runs after requireAuth.
export function rateLimitByUser(name: string, limit: number, windowSeconds: number) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    await hit(`ratelimit:${name}:user:${c.var.userId}`, limit, windowSeconds);
    await next();
  });
}
