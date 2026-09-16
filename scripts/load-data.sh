#!/usr/bin/env bash
#
# ONE-TIME load of the historical data (projects, permits, companies,
# committees) from your local database into a deployed environment.
#
#   scripts/load-data.sh dev
#
# Reads the local database from .env (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD).
# The target must already be migrated and must have no projects yet — the
# Lambda refuses otherwise, so this cannot duplicate data by accident.
#
# Privacy: the dump is private data. It goes to the environment's own
# encrypted, non-public bucket under ops/, the Lambda deletes it right after
# loading (a lifecycle rule removes any leftover within a day), and the local
# temp file is deleted on exit. It never touches git.
#
source "$(dirname "$0")/lib.sh"
require_stage "${1:-}"
STAGE="$1"

cd "$(dirname "$0")/.."
# Only the DB_* lines: .env also carries AWS_* for the local API (often empty,
# e.g. AWS_REGION=), and sourcing those would break the AWS CLI calls below.
if [ -f .env ]; then set -a && source <(grep -E '^DB_[A-Z_]+=' .env) && set +a; fi
: "${DB_HOST:?DB_HOST is not set (.env)}"
: "${DB_NAME:?DB_NAME is not set (.env)}"
: "${DB_USER:?DB_USER is not set (.env)}"
export PGPASSWORD="${DB_PASSWORD:-}"

DUMP="$(mktemp --suffix=.sql)"
trap 'rm -f "$DUMP"' EXIT

echo "==> Dumping data from local ${DB_NAME}"
# Data only, as plain INSERTs (the Lambda runs it through the pg driver, which
# cannot do COPY FROM stdin). Catalogs (regiones, sectores, ...) are left out:
# schema.sql already seeds them with the same ids. Users, history and pending
# requests are left out too: they belong to each environment.
#
# --column-inserts, not --inserts: a database brought up to date by migrations
# has added columns at the END of the table, while a fresh one built from
# schema.sql has them in schema order. Positional INSERTs would put values in
# the wrong columns; named ones do not care about order.
pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
  --data-only --column-inserts --no-owner --no-privileges --no-comments \
  -t public.empresas -t public.proyectos -t public.permisos \
  -t public.comites -t public.permisos_comite \
| awk '
    # pg_dump opens with session SETs; a newer pg_dump than the server emits
    # some the server rejects (transaction_timeout), plus psql-only \restrict
    # lines. None matter for plain INSERTs, so drop the header ones.
    !started && /^INSERT INTO / { started = 1 }
    !started && (/^SET / || /^SELECT pg_catalog\.set_config/) { next }
    /^\\(un)?restrict / { next }
    { print }
  ' > "$DUMP"

echo "    $(grep -c '^INSERT INTO' "$DUMP") rows, $(du -h "$DUMP" | cut -f1)"

BUCKET="$(stack_output "Oasi-${STAGE}" AttachmentsBucket)"
KEY="ops/data-$(date +%Y%m%d%H%M%S).sql"

echo "==> Uploading to s3://${BUCKET}/${KEY}"
aws s3 cp "$DUMP" "s3://${BUCKET}/${KEY}" --sse AES256 --only-show-errors

echo "==> Loading (the Lambda deletes the dump from S3 afterwards)"
invoke_db_ops "$STAGE" "{\"action\":\"load-data\",\"key\":\"${KEY}\"}"
