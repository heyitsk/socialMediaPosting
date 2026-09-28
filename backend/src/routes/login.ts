import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { upsertUserFromGoogle } from "../db/users";
import { env } from "../lib/env";
import { buildLoginUrl, exchangeLoginCode, randomToken, verifyIdToken } from "../lib/google-login";
import { redis } from "../lib/redis";
import { createSession, destroySession } from "../lib/session";

const STATE_TTL_SECONDS = 300;
const STATE_COOKIE = "login_state";

interface LoginState {
  codeVerifier: string;
  nonce: string;
  next: string;
}

function stateKey(state: string): string {
  return `oauth:state:login:${state}`;
}

// Only same-site relative paths — anything else (absolute URLs,
// protocol-relative "//evil.com", "/\evil.com") would make this an open
// redirector (OWASP OAuth 2.0 Cheat Sheet, Essential Basics #1).
function safeNext(next: string | undefined): string {
  if (
    !next ||
    next.length > 512 ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  ) {
    return "/";
  }
  return next;
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function loginError(code: string): string {
  return `${env.FRONTEND_URL}/login?error=${code}`;
}

export const loginRoute = new Hono();

loginRoute.get("/google", async (c) => {
  const state = randomToken();
  const record: LoginState = {
    codeVerifier: randomToken(),
    nonce: randomToken(),
    next: safeNext(c.req.query("next")),
  };
  await redis.set(stateKey(state), JSON.stringify(record), "EX", STATE_TTL_SECONDS);

  // Binds the flow to this browser: the callback only proceeds if the same
  // browser that started it presents this cookie (OWASP #2 — state must be
  // bound to the user agent, not just "exist in Redis").
  setCookie(c, STATE_COOKIE, state, {
    prefix: "host",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: STATE_TTL_SECONDS,
  });

  return c.redirect(
    buildLoginUrl({ state, nonce: record.nonce, codeVerifier: record.codeVerifier }),
  );
});

loginRoute.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, STATE_COOKIE, "host");
  deleteCookie(c, STATE_COOKIE, { prefix: "host" });

  if (c.req.query("error") || !code || !state) {
    return c.redirect(loginError("login_denied"));
  }
  if (!cookieState || !sameToken(state, cookieState)) {
    return c.redirect(loginError("login_invalid_state"));
  }

  // Single use: read and delete in one round trip so a replayed callback
  // finds nothing.
  const raw = await redis.getdel(stateKey(state));
  if (!raw) {
    return c.redirect(loginError("login_invalid_state"));
  }
  const record = JSON.parse(raw) as LoginState;

  try {
    const idToken = await exchangeLoginCode(code, record.codeVerifier);
    const identity = await verifyIdToken(idToken, record.nonce);
    const user = await upsertUserFromGoogle(identity);

    // Rotate: drop whatever session this browser had before (session
    // fixation), then issue a fresh one.
    await destroySession(c);
    await createSession(c, user.id);

    return c.redirect(`${env.FRONTEND_URL}${record.next}`);
  } catch (err) {
    // Message only — never log the code, state or id_token.
    console.error("Google login callback failed:", err instanceof Error ? err.message : err);
    return c.redirect(loginError("login_failed"));
  }
});
