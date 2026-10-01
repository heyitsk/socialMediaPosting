#!/usr/bin/env bash
# Loads observability/alerts/rules.json into Grafana as the "smposting" rule
# group in the "smPosting" folder, replacing earlier versions, and makes sure
# the "smposting-email" contact point the rules notify exists
# (websitePlan.md §14.8).
#
#   Local otel-lgtm:  ALERT_EMAIL=you@example.com ./observability/import-alerts.sh
#   Grafana Cloud:    GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<service account token> \
#                     PROMETHEUS_UID=grafanacloud-prom LOKI_UID=grafanacloud-logs \
#                     ALERT_EMAIL=you@example.com ./observability/import-alerts.sh
#
# ALERT_EMAIL is only needed the first time (it creates the contact point).
# Local otel-lgtm has no SMTP server, so rules fire there but no email is sent;
# Grafana Cloud sends email out of the box.
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"
PROMETHEUS_UID="${PROMETHEUS_UID:-prometheus}"
LOKI_UID="${LOKI_UID:-loki}"
RULES="$(cd "$(dirname "$0")" && pwd)/alerts/rules.json"
FOLDER_UID="smposting"
GROUP="smposting"
RECEIVER="smposting-email"

if [[ -n "${GRAFANA_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer ${GRAFANA_TOKEN}")
else
  auth=(-u "${GRAFANA_USER:-admin}:${GRAFANA_PASSWORD:-admin}")
fi

api() {
  # X-Disable-Provenance keeps the rules editable in the Grafana UI.
  curl -sS --fail-with-body "${auth[@]}" -H "Content-Type: application/json" \
    -H "X-Disable-Provenance: true" "$@"
}

api -X POST "${GRAFANA_URL}/api/folders" \
  -d "{\"uid\":\"${FOLDER_UID}\",\"title\":\"smPosting\"}" >/dev/null 2>&1 || true

if ! api "${GRAFANA_URL}/api/v1/provisioning/contact-points?name=${RECEIVER}" | grep -q "\"name\":\"${RECEIVER}\""; then
  if [[ -z "${ALERT_EMAIL:-}" ]]; then
    echo "Contact point ${RECEIVER} doesn't exist yet: set ALERT_EMAIL to create it." >&2
    exit 1
  fi
  api -X POST "${GRAFANA_URL}/api/v1/provisioning/contact-points" -d "{
    \"name\": \"${RECEIVER}\", \"type\": \"email\",
    \"settings\": {\"addresses\": \"${ALERT_EMAIL}\", \"singleEmail\": true}
  }" >/dev/null
  echo "created contact point ${RECEIVER}"
fi

body=$(sed -e "s/\${PROMETHEUS_UID}/${PROMETHEUS_UID}/g" -e "s/\${LOKI_UID}/${LOKI_UID}/g" "$RULES")
api -X PUT "${GRAFANA_URL}/api/v1/provisioning/folder/${FOLDER_UID}/rule-groups/${GROUP}" -d "$body" >/dev/null
echo "loaded rule group ${GROUP}: $(grep -c '"uid": "smposting-' "$RULES") rules"
