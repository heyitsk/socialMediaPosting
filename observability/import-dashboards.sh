#!/usr/bin/env bash
# Loads observability/dashboards/*.json into a Grafana, in an "smPosting"
# folder, overwriting earlier versions (websitePlan.md §14.8).
#
#   Local otel-lgtm (default):  ./observability/import-dashboards.sh
#   Grafana Cloud:              GRAFANA_URL=https://<stack>.grafana.net \
#                               GRAFANA_TOKEN=<service account token> ./observability/import-dashboards.sh
#
# The dashboards pick their data sources through variables, so the same files
# work on both.
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"
DIR="$(cd "$(dirname "$0")" && pwd)/dashboards"
FOLDER_UID="smposting"

if [[ -n "${GRAFANA_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer ${GRAFANA_TOKEN}")
else
  auth=(-u "${GRAFANA_USER:-admin}:${GRAFANA_PASSWORD:-admin}")
fi

api() {
  curl -sS --fail-with-body "${auth[@]}" -H "Content-Type: application/json" "$@"
}

# Create the folder once; a 409/412 means it already exists.
api -X POST "${GRAFANA_URL}/api/folders" \
  -d "{\"uid\":\"${FOLDER_UID}\",\"title\":\"smPosting\"}" >/dev/null 2>&1 || true

for file in "${DIR}"/*.json; do
  body=$(printf '{"dashboard":%s,"folderUid":"%s","overwrite":true}' "$(cat "$file")" "$FOLDER_UID")
  result=$(api -X POST "${GRAFANA_URL}/api/dashboards/db" -d "$body")
  echo "$(basename "$file"): $(printf '%s' "$result" | grep -o '"url":"[^"]*"' || printf '%s' "$result")"
done
