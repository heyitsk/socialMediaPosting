#!/bin/sh
# Gives n8n its own database and login on the shared Postgres. The postgres
# image runs this once, when its data volume is first created.
set -e

psql -v ON_ERROR_STOP=1 -v n8n_password="$N8N_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE n8n LOGIN PASSWORD :'n8n_password';
CREATE DATABASE n8n OWNER n8n;
SQL
