import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // Single origin in dev (websitePlan.md §9.2): the one free ngrok domain
  // points here, and /api/* — including every OAuth callback — is proxied to
  // the backend, so the session cookie is first-party everywhere.
  server: {
    allowedHosts: [".ngrok-free.dev"],
    proxy: {
      "/api": { target: "http://localhost:4000", xfwd: true },
    },
  },
});
