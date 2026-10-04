# smPosting backend: API + BullMQ workers in one Bun process.
# Build from the repo root, where the workspace lockfile lives:
#   docker build -f backend/Dockerfile .

FROM oven/bun:1.3.13-slim

# ffmpeg/ffprobe: video probing and rendering (lib/media-probe.ts,
# lib/render.ts). openssl + ca-certificates: Prisma's engine and outbound TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first, so a code-only change reuses the cached install layer.
# frontend/package.json is only here because the lockfile lists both
# workspaces; --filter keeps its packages out of the image.
COPY package.json bun.lock ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Not --production: the prisma CLI is a devDependency and the entrypoint
# needs it for `migrate deploy`.
RUN bun install --frozen-lockfile --filter backend

COPY backend backend/
WORKDIR /app/backend
RUN bunx prisma generate

ENV NODE_ENV=production
USER bun
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Apply pending migrations, then start. Never `migrate dev` here: it can
# reset the database.
CMD ["sh", "-c", "bunx prisma migrate deploy && exec bun src/index.ts"]
