#!/usr/bin/env bash
# Stores the production config in SSM Parameter Store, where deploy.sh reads
# it on the server. Run on your laptop after `aws sso login --profile smposting-admin`:
#   deploy/put-secrets.sh
#
# Safe to re-run:
# - Generated keys (database passwords, encryption keys) are created once and
#   never replaced. Replacing N8N_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEY_V1
#   would make the credentials and tokens already saved with them unreadable.
# - Everything else is kept unless you answer "y" to replacing it.
# - OAuth app values can be copied from backend/.env, since testers use the
#   same Meta, Google and LinkedIn apps as dev.
#
# Every value is stored as a SecureString (encrypted with the aws/ssm key).
# Values never appear on screen or on a command line.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-smposting-admin}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
PREFIX=/smposting/prod
DEV_ENV="${DEV_ENV:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backend/.env}"

umask 077
REQUEST="$(mktemp)"
trap 'rm -f "$REQUEST"' EXIT

exists() {
  aws ssm get-parameter --name "$PREFIX/$1" --query Parameter.Name --output text >/dev/null 2>&1
}

# Sent as a JSON file rather than --value, so the value isn't visible in the
# process list and the CLI never treats it as a file:// or http:// reference.
put() {
  local name="$1" value="$2" overwrite="$3"
  if [[ "$value" == *"'"* ]]; then
    echo "  ! $name can't contain a single quote (deploy.sh rejects it); skipped" >&2
    return
  fi
  jq -n --arg n "$PREFIX/$name" --arg v "$value" --argjson o "$overwrite" \
    '{Name: $n, Value: $v, Type: "SecureString", Overwrite: $o}' >"$REQUEST"
  aws ssm put-parameter --cli-input-json "file://$REQUEST" >/dev/null
  echo "  saved $name"
}

# A value from backend/.env, without surrounding quotes. Empty if absent.
dev_value() {
  [[ -f "$DEV_ENV" ]] || return 0
  grep -E "^$1=" "$DEV_ENV" | tail -1 | cut -d= -f2- | sed -E "s/^[\"'](.*)[\"']$/\1/"
}

# First and last 3 characters only, e.g. "abc…xyz (32 chars)".
mask() {
  local v="$1"
  if ((${#v} <= 8)); then echo "*** (${#v} chars)"; else echo "${v:0:3}…${v: -3} (${#v} chars)"; fi
}

# Created once from $2 (a command), never replaced.
generated() {
  local name="$1" cmd="$2"
  if exists "$name"; then
    echo "  kept $name (generated keys are never replaced)"
  else
    put "$name" "$($cmd)" false
  fi
}

# Asks for a value. $2 = prompt, $3 = suggested value, $4 = "secret" to hide
# input and mask the suggestion.
ask() {
  local name="$1" prompt="$2" suggested="${3:-}" secret="${4:-}" reply value shown
  if exists "$name"; then
    read -r -p "  $name is already set. Replace it? [y/N] " reply
    [[ "$reply" =~ ^[Yy] ]] || { echo "  kept $name"; return; }
  fi
  if [[ -n "$suggested" ]]; then
    if [[ "$secret" == secret ]]; then shown="$(mask "$suggested")"; else shown="$suggested"; fi
    read -r -p "  $prompt [Enter = $shown]: " value
    value="${value:-$suggested}"
  elif [[ "$secret" == secret ]]; then
    read -r -s -p "  $prompt (hidden): " value
    echo
  else
    read -r -p "  $prompt: " value
  fi
  if [[ -z "$value" ]]; then
    echo "  ! $name left empty; skipped. The backend won't start without it." >&2
    return
  fi
  put "$name" "$value" true
}

# The OAuth app values, offered from backend/.env.
from_dev() {
  local name="$1" label="$2" secret="${3:-}"
  ask "backend/$name" "$label" "$(dev_value "$name")" "$secret"
}

echo "Account: $(aws sts get-caller-identity --query Arn --output text)"
echo "Region:  $AWS_REGION   Prefix: $PREFIX"
[[ -f "$DEV_ENV" ]] && echo "Offering OAuth values from $DEV_ENV"

echo
echo "== Generated secrets"
generated compose/POSTGRES_PASSWORD "openssl rand -hex 32"
generated compose/N8N_DB_PASSWORD "openssl rand -hex 32"
generated compose/N8N_ENCRYPTION_KEY "openssl rand -hex 32"
generated compose/N8N_CALLBACK_SECRET "openssl rand -hex 32"
generated backend/TOKEN_ENCRYPTION_KEY_V1 "openssl rand -base64 32"

echo
echo "== Server settings"
ask compose/DOMAIN "Domain (no https://, no app.)" "postuploaders.com"
ask compose/ACME_EMAIL "Email for Let's Encrypt certificate warnings"
ask backend/S3_MEDIA_BUCKET "Media bucket" "smposting-media-675474620265-ap-south-1"
ask backend/AWS_REGION "AWS region" "$AWS_REGION"
ask backend/POSTING_LIMITS_PROFILE "Posting limits (dev while Meta is in Development mode)" "dev"

echo
echo "== Meta app (Facebook, Instagram, Threads)"
ask backend/META_GRAPH_VERSION "Graph API version" "$(dev_value META_GRAPH_VERSION)"
from_dev META_APP_ID "Meta app ID"
from_dev META_APP_SECRET "Meta app secret" secret
from_dev INSTAGRAM_APP_ID "Instagram app ID"
from_dev INSTAGRAM_APP_SECRET "Instagram app secret" secret
from_dev THREADS_APP_ID "Threads app ID"
from_dev THREADS_APP_SECRET "Threads app secret" secret

echo
echo "== LinkedIn app"
from_dev LINKEDIN_CLIENT_ID "LinkedIn client ID"
from_dev LINKEDIN_CLIENT_SECRET "LinkedIn client secret" secret

echo
echo "== Google: YouTube project"
from_dev GOOGLE_CLIENT_ID "YouTube OAuth client ID"
from_dev GOOGLE_CLIENT_SECRET "YouTube OAuth client secret" secret

echo
echo "== Google: login project"
from_dev LOGIN_GOOGLE_CLIENT_ID "Login OAuth client ID"
from_dev LOGIN_GOOGLE_CLIENT_SECRET "Login OAuth client secret" secret

echo
echo "== Stored under $PREFIX (names only)"
aws ssm get-parameters-by-path --path "$PREFIX" --recursive --query "Parameters[].Name" --output text |
  tr '\t' '\n' | sed "s#^$PREFIX/#  #" | sort
