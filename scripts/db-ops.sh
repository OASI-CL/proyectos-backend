#!/usr/bin/env bash
#
# Operaciones sobre la base de datos de un ambiente desplegado, a través de su
# Lambda db-ops (la base es privada: esta es la puerta de entrada).
#
#   scripts/db-ops.sh dev status           migraciones aplicadas y filas por tabla
#   scripts/db-ops.sh dev migrate          aplica las migraciones pendientes
#   scripts/db-ops.sh dev check-isolation  prueba que las credenciales de este
#                                          ambiente NO abran la base del otro
#
# Para migrar es equivalente a: npm run db:migrate -- --env=dev
# Usa tus credenciales de AWS (export AWS_PROFILE=oasi).
#
source "$(dirname "$0")/lib.sh"
require_env "${1:-}"

case "${2:-}" in
  status|migrate|check-isolation) invoke_db_ops "$1" "{\"action\":\"$2\"}" ;;
  *) echo "Uso: $0 <dev|prod> <status|migrate|check-isolation>" >&2; exit 2 ;;
esac
