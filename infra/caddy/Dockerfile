# Caddy with the built frontend baked in, so one image carries both the SPA
# and the proxy config. Build from the repo root:
#   docker build -f infra/caddy/Dockerfile .

# Stage 1: build the SPA. Only dist/ is kept; Bun and node_modules are thrown
# away with this stage.
FROM oven/bun:1.3.13-slim AS frontend
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile --filter frontend
COPY frontend frontend/
# Optional Grafana Faro telemetry (frontend/.env.example). Vite inlines these
# at build time, so they're build args, not runtime env.
ARG VITE_FARO_URL=""
ARG VITE_APP_VERSION=""
ENV VITE_FARO_URL=$VITE_FARO_URL VITE_APP_VERSION=$VITE_APP_VERSION
RUN cd frontend && bun run build

# Stage 2: the image that actually runs.
FROM caddy:2.10-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /app/frontend/dist /srv
