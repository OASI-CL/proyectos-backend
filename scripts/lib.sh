#!/usr/bin/env bash
# Shared helpers for the scripts/*.sh that operate a deployed environment.
# Sourced, not executed.

set -euo pipefail

require_stage() {
  case "${1:-}" in
    dev|prod) ;;
    *) echo "Usage: $0 <dev|prod> ..." >&2; exit 2 ;;
  esac
}

# stack_output <stack> <OutputKey>
stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# invoke_db_ops <stage> <json-payload>
# Prints the function's JSON result; exits non-zero if the function failed.
invoke_db_ops() {
  local stage="$1" payload="$2" out
  out="$(mktemp)"
  trap 'rm -f "$out"' RETURN

  local meta
  meta="$(aws lambda invoke \
    --function-name "oasi-${stage}-db-ops" \
    --cli-binary-format raw-in-base64-out \
    --cli-read-timeout 330 \
    --payload "$payload" \
    "$out")"

  cat "$out"; echo
  if echo "$meta" | grep -q '"FunctionError"'; then
    echo "db-ops failed (details above; full log in CloudWatch /aws/lambda/oasi-${stage}-db-ops)" >&2
    return 1
  fi
}
