import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "./env";
import { tracedFetch } from "./tracing";

// "Sign in with Google" — OpenID Connect, Authorization Code + PKCE + nonce
// (OWASP OAuth 2.0 Cheat Sheet). This is app login, not a platform connect:
// only the id_token's identity claims are used, Google's access/refresh
// tokens are thrown away. Separate client from lib/youtube.ts.
const REDIRECT_URI = `${env.PUBLIC_BACKEND_URL}/api/login/google/callback`;

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// jose caches the keys and refetches on an unknown `kid`, so Google's key
// rotation needs no handling here.
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function buildLoginUrl(params: {
  state: string;
  nonce: string;
  codeVerifier: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.LOGIN_GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the account chooser — users with several Google accounts
  // (common for agency staff) otherwise get silently signed in as whichever
  // one is active in the browser.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeLoginCode(code: string, codeVerifier: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    client_id: env.LOGIN_GOOGLE_CLIENT_ID,
    client_secret: env.LOGIN_GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await tracedFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    // Status only — the body can echo the code back.
    throw new Error(`Google login token exchange failed (${response.status})`);
  }
  const token = (await response.json()) as { id_token?: string };
  if (!token.id_token) {
    throw new Error("Google login token response had no id_token");
  }
  return token.id_token;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: GOOGLE_ISSUERS,
    audience: env.LOGIN_GOOGLE_CLIENT_ID,
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error("id_token nonce mismatch");
  }
  // An unverified email must never be trusted — it's what invites and the
  // seeded-user link are matched on.
  if (payload.email_verified !== true || typeof payload.email !== "string" || !payload.sub) {
    throw new Error("id_token has no verified email");
  }

  const email = payload.email.toLowerCase();
  return {
    sub: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name : email,
    avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
  };
}
