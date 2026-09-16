#!/usr/bin/env bash
#
# Runs a database operation in a deployed environment, through its db-ops
# Lambda (the database is private; this is the way in).
#
#   scripts/db-ops.sh dev status     applied migrations and row counts
#   scripts/db-ops.sh dev migrate    apply pending migrations (CI does this after each deploy)
#
# Uses your AWS CLI credentials (e.g. export AWS_PROFILE=oasi).
#
source "$(dirname "$0")/lib.sh"
require_stage "${1:-}"

case "${2:-}" in
  status|migrate) invoke_db_ops "$1" "{\"action\":\"$2\"}" ;;
  *) echo "Usage: $0 <dev|prod> <status|migrate>" >&2; exit 2 ;;
esac
