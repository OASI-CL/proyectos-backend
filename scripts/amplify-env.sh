#!/usr/bin/env bash
#
# Points an Amplify branch at an environment, from the deployed stack outputs,
# so no value is ever copied by hand.
#
#   scripts/amplify-env.sh <amplify-app-id> develop dev
#   scripts/amplify-env.sh <amplify-app-id> main    prod
#
# Sets, for that branch only: VITE_API_URL, VITE_COGNITO_USER_POOL_ID,
# VITE_COGNITO_CLIENT_ID, VITE_COGNITO_REGION. Sets the app's SPA rewrite
# (deep links like /permisos/42 serve index.html). Starts a build.
#
source "$(dirname "$0")/lib.sh"
APP_ID="${1:?Usage: $0 <amplify-app-id> <branch> <dev|prod>}"
BRANCH="${2:?Usage: $0 <amplify-app-id> <branch> <dev|prod>}"
require_stage "${3:-}"
STAGE="$3"

API_URL="$(stack_output "Oasi-${STAGE}" ApiUrl)"
API_URL="${API_URL%/}"
POOL_ID="$(stack_output "Oasi-Auth-${STAGE}" UserPoolId)"
CLIENT_ID="$(stack_output "Oasi-Auth-${STAGE}" UserPoolClientId)"
REGION="$(aws configure get region || echo us-east-1)"

AMPLIFY_STAGE=$([ "$STAGE" = prod ] && echo PRODUCTION || echo DEVELOPMENT)

echo "==> Branch ${BRANCH} -> ${STAGE}"
echo "    VITE_API_URL=${API_URL}"
echo "    VITE_COGNITO_USER_POOL_ID=${POOL_ID}"
echo "    VITE_COGNITO_CLIENT_ID=${CLIENT_ID}"
aws amplify update-branch \
  --app-id "$APP_ID" --branch-name "$BRANCH" --stage "$AMPLIFY_STAGE" \
  --environment-variables "VITE_API_URL=${API_URL},VITE_COGNITO_USER_POOL_ID=${POOL_ID},VITE_COGNITO_CLIENT_ID=${CLIENT_ID},VITE_COGNITO_REGION=${REGION}" \
  >/dev/null

echo "==> SPA rewrite"
RULES="$(mktemp)"
trap 'rm -f "$RULES"' EXIT
cat > "$RULES" <<'JSON'
[{"source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>", "target": "/index.html", "status": "200"}]
JSON
aws amplify update-app --app-id "$APP_ID" --custom-rules "file://${RULES}" >/dev/null

echo "==> Starting a build"
aws amplify start-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-type RELEASE \
  --query 'jobSummary.jobId' --output text >/dev/null

DOMAIN="$(aws amplify get-app --app-id "$APP_ID" --query 'app.defaultDomain' --output text)"
echo "==> Site: https://${BRANCH}.${DOMAIN}"
echo "    Add that URL to ${STAGE}.frontendOrigins in infra/lib/config.ts and push, or the API will reject it (CORS)."
