import createClient from "openapi-fetch";
import type { paths } from "@/lib/api-schema";

// Same origin as the page — Vite (dev) or the reverse proxy (prod) forwards
// /api to the backend, so the session cookie is always first-party.
export const API_URL = import.meta.env.VITE_API_URL ?? "";

export const api = createClient<paths>({
  baseUrl: API_URL,
  credentials: "include",
});

// Session expired or was revoked mid-use (logout elsewhere, 7-day idle) —
// bounce to /login and come back here afterwards. /api/me is excluded: its
// 401 is how the RequireAuth guard learns there's no session at all.
api.use({
  onResponse({ request, response }) {
    if (response.status !== 401 || new URL(request.url).pathname === "/api/me") return;
    if (window.location.pathname === "/login") return;
    const next = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  },
});
