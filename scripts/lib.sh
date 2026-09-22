#!/usr/bin/env bash
# Helpers compartidos por los scripts que operan un ambiente desplegado.
# Se incluye con `source`, no se ejecuta.

set -euo pipefail

require_env() {
  case "${1:-}" in
    dev|prod) ;;
    *) echo "Uso: $0 <dev|prod> ..." >&2; exit 2 ;;
  esac
}

# stack_output <stack> <OutputKey>
stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# invoke_db_ops <env> <json>
# Imprime el resultado de la Lambda; termina con error si la Lambda falló.
invoke_db_ops() {
  local env="$1" payload="$2" out meta
  out="$(mktemp)"
  trap 'rm -f "$out"' RETURN

  meta="$(aws lambda invoke \
    --function-name "oasi-db-ops-${env}" \
    --cli-binary-format raw-in-base64-out \
    --cli-read-timeout 330 \
    --payload "$payload" \
    "$out")"

  cat "$out"; echo
  if echo "$meta" | grep -q '"FunctionError"'; then
    echo "db-ops falló (detalle arriba; log completo en CloudWatch /aws/lambda/oasi-db-ops-${env})" >&2
    return 1
  fi
}
