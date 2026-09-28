import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { canManageAccounts, getRole } from "../db/workspaces";
import { env } from "./env";
import { redis } from "./redis";
import { readSession } from "./session";

// Shared start/callback bookkeeping for the platform connect flows
// (routes/auth/*). The OAuth `state` maps to the user + workspace that
// started the connect, and the callback only proceeds for that same signed-in
// user — so an attacker can't get their Page written into a victim's
// workspace, or the reverse, by feeding someone a callback URL (OWASP OAuth
// 2.0 Cheat Sheet: state must be bound to the user agent). websitePlan.md §9.5.
const STATE_TTL_SECONDS = 300;

interface ConnectState {
  userId: string;
  workspaceId: string;
  // Only set by flows that use PKCE (currently YouTube).
  codeVerifier?: string;
}

export interface ConnectContext {
  code: string;
  userId: string;
  workspaceId: string;
  codeVerifier?: string;
}

function stateKey(platform: string, state: string): string {
  return `oauth:state:${platform}:${state}`;
}

// Back to the workspace the account was connected to when it's known and
// the user is confirmed a member of it; otherwise the app root, which
// forwards to their last-used workspace.
export function connectRedirect(query: string, workspaceId?: string): string {
  const path = workspaceId ? `/w/${encodeURIComponent(workspaceId)}` : "/";
  return `${env.FRONTEND_URL}${path}?${query}`;
}

// Returns the provider state to send, or a Response to return instead when
// the user isn't signed in / isn't an owner or admin of the requested
// workspace (plain members can't connect accounts — websitePlan.md §9.7).
export async function beginConnect(
  c: Context,
  platform: string,
  options: { codeVerifier?: string } = {},
): Promise<{ state: string } | { response: Response }> {
  const userId = await readSession(c);
  if (!userId) {
    return { response: c.redirect(`${env.FRONTEND_URL}/login`) };
  }

  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId || !canManageAccounts(await getRole(userId, workspaceId))) {
    return { response: c.redirect(connectRedirect(`error=${platform}_connect_forbidden`)) };
  }

  const state = randomBytes(16).toString("hex");
  const record: ConnectState = { userId, workspaceId, codeVerifier: options.codeVerifier };
  await redis.set(stateKey(platform, state), JSON.stringify(record), "EX", STATE_TTL_SECONDS);
  return { state };
}

export async function finishConnect(
  c: Context,
  platform: string,
): Promise<{ ctx: ConnectContext } | { response: Response }> {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const fail = (reason: string) => ({
    response: c.redirect(connectRedirect(`error=${platform}_connect_${reason}`)),
  });

  if (c.req.query("error") || !code || !state) {
    return fail("denied");
  }

  // Single use — a replayed callback finds nothing.
  const raw = await redis.getdel(stateKey(platform, state));
  if (!raw) {
    return fail("invalid_state");
  }
  const record = JSON.parse(raw) as ConnectState;

  // Same browser, same user that started the flow — and still an owner/admin
  // (they could have been removed or demoted, or the workspace deleted, in the
  // few minutes the consent screen was open).
  const userId = await readSession(c);
  if (userId !== record.userId || !canManageAccounts(await getRole(userId, record.workspaceId))) {
    return fail("invalid_state");
  }

  return { ctx: { ...record, code } };
}
