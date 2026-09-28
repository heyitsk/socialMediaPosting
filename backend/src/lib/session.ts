import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { redis } from "./redis";

// Opaque session token in a __Host- cookie, session record in Redis — not a
// stateless JWT, so logout / "log out everywhere" / removing someone from a
// workspace take effect immediately (websitePlan.md §9.1).
const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "sid";

interface SessionRecord {
  userId: string;
  createdAt: number;
}

// Only the hash is used as the key, so a Redis dump doesn't contain usable
// session tokens.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionKey(hash: string): string {
  return `session:${hash}`;
}

function userSessionsKey(userId: string): string {
  return `user-sessions:${userId}`;
}

export async function createSession(c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const hash = hashToken(token);
  const record: SessionRecord = { userId, createdAt: Date.now() };

  await redis
    .multi()
    .set(sessionKey(hash), JSON.stringify(record), "EX", SESSION_IDLE_SECONDS)
    .sadd(userSessionsKey(userId), hash)
    .pexpire(userSessionsKey(userId), SESSION_MAX_AGE_MS)
    .exec();

  // prefix "host" → cookie name __Host-sid, which forces Secure + Path=/ and
  // forbids a Domain attribute. Lax, not Strict: the cookie has to come along
  // on the top-level redirects back from Meta/Google/LinkedIn to the connect
  // callbacks.
  setCookie(c, COOKIE_NAME, token, {
    prefix: "host",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

// Returns the signed-in user id, sliding the idle expiry forward — or null
// if there's no cookie, the session expired, or it hit the 30-day hard cap.
export async function readSession(c: Context): Promise<string | null> {
  const token = getCookie(c, COOKIE_NAME, "host");
  if (!token) return null;

  const key = sessionKey(hashToken(token));
  const raw = await redis.get(key);
  if (!raw) return null;

  const record = JSON.parse(raw) as SessionRecord;
  const remainingMs = record.createdAt + SESSION_MAX_AGE_MS - Date.now();
  if (remainingMs <= 0) {
    await redis.del(key);
    return null;
  }

  await redis.pexpire(key, Math.min(SESSION_IDLE_SECONDS * 1000, remainingMs));
  return record.userId;
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, COOKIE_NAME, "host");
  if (token) {
    const hash = hashToken(token);
    const raw = await redis.get(sessionKey(hash));
    await redis.del(sessionKey(hash));
    if (raw) {
      await redis.srem(userSessionsKey((JSON.parse(raw) as SessionRecord).userId), hash);
    }
  }
  deleteCookie(c, COOKIE_NAME, { prefix: "host" });
}

export async function destroyAllSessions(userId: string): Promise<void> {
  const hashes = await redis.smembers(userSessionsKey(userId));
  await redis.del(userSessionsKey(userId), ...hashes.map(sessionKey));
}
