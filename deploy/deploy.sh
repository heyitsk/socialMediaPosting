#!/usr/bin/env bash
# Deploys smPosting on the app server. Run as root from anywhere:
#   /opt/smposting/deploy/deploy.sh                # deploy origin/production
#   /opt/smposting/deploy/deploy.sh <git-ref>      # deploy a specific commit/tag
#   /opt/smposting/deploy/deploy.sh --env-only     # only rewrite the env files
#
# 1. Checks out the requested commit (the server's clone of the repo).
# 2. Writes deploy/.env and deploy/backend.env from SSM Parameter Store:
#      /smposting/prod/compose/<NAME>  -> .env         (${VAR}s in the compose file)
#      /smposting/prod/backend/<NAME>  -> backend.env  (the backend's app config)
# 3. Builds the images and (re)starts the stack, waiting until it's healthy.
#
# Needs: git, docker compose, aws CLI, jq, and an instance role that can read
# /smposting/prod/* (infra/app-server.yaml).
set -euo pipefail

SSM_PREFIX=/smposting/prod
export AWS_REGION="${AWS_REGION:-ap-south-1}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$DEPLOY_DIR")"

log() { echo "[deploy $(date +%H:%M:%S)] $*"; }

# Writes every parameter under $1 to file $2 as NAME='value'. Single quotes
# so compose takes the value literally (no $-interpolation); a value that
# itself contains a single quote is rejected rather than mangled.
write_env_file() {
  local path="$1" out="$2" lines tmp
  # Fetched in full before anything touches the disk, so a failure leaves the
  # previous env file in place.
  lines="$(aws ssm get-parameters-by-path --path "$path" --recursive --with-decryption --output json |
    jq -r --arg q "'" '.Parameters[]
      | (.Name | split("/") | last) as $k
      | if (.Value | contains($q)) then error("\($k) contains a single quote")
        else "\($k)=\($q)\(.Value)\($q)" end')"
  if [[ -z "$lines" ]]; then
    echo "No parameters found under $path" >&2
    exit 1
  fi
  tmp="$(mktemp "$out.XXXXXX")"
  printf '%s\n' "$lines" >"$tmp"
  mv "$tmp" "$out"
  log "wrote $(wc -l <"$out") values to $(basename "$out")"
}

ref="origin/production"
env_only=false
case "${1:-}" in
  --env-only) env_only=true ;;
  "") ;;
  *) ref="$1" ;;
esac

if [[ "$env_only" == false ]]; then
  log "fetching $ref"
  git -C "$REPO_DIR" fetch --prune --tags origin
  # Detached checkout: the server runs exactly the commit asked for and never
  # has local changes of its own.
  git -C "$REPO_DIR" checkout --force --detach "$ref"
fi
sha="$(git -C "$REPO_DIR" rev-parse --short HEAD)"

umask 077
write_env_file "$SSM_PREFIX/compose" "$DEPLOY_DIR/.env"
write_env_file "$SSM_PREFIX/backend" "$DEPLOY_DIR/backend.env"
# Tags the backend's telemetry with the commit it's running.
echo "OTEL_RESOURCE_ATTRIBUTES='service.version=$sha'" >>"$DEPLOY_DIR/backend.env"

if [[ "$env_only" == true ]]; then
  log "env files written; stack not restarted"
  exit 0
fi

log "building and starting $sha"
cd "$DEPLOY_DIR"
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans --wait --wait-timeout 300
# Each build leaves the previous images untagged; drop them so the disk
# doesn't fill up.
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml ps --format "table {{.Service}}\t{{.Status}}"
log "deployed $sha"
