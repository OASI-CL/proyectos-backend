#!/usr/bin/env bash
#
# Applies db/schema.sql (fresh database) or db/migrations/*.sql (existing one).
#
#   Local:  npm run migrate
#   AWS:    the RDS instance is in a private subnet, so run this from a bastion
#           or through an SSM port-forward session (see DEPLOYMENT.md).
#
# Reads DB_* from the environment, falling back to .env.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a && . ./.env && set +a
fi

: "${DB_HOST:?DB_HOST is not set}"
: "${DB_NAME:?DB_NAME is not set}"
: "${DB_USER:?DB_USER is not set}"

export PGPASSWORD="${DB_PASSWORD:-}"
PSQL="psql -h $DB_HOST -p ${DB_PORT:-5432} -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1"

# A fresh database has no `proyectos` table yet.
if $PSQL -tAc "SELECT to_regclass('public.proyectos')" | grep -q proyectos; then
  echo "==> Existing database, applying migrations"
  for file in db/migrations/*.sql; do
    [ -e "$file" ] || continue
    echo "    $file"
    $PSQL -q -f "$file"
  done
else
  echo "==> Empty database, applying full schema"
  $PSQL -q -f db/schema.sql
fi

echo "==> Done"
