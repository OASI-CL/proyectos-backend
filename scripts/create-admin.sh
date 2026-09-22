#!/usr/bin/env bash
#
# Creates the FIRST admin of an environment — both halves:
#   1. the Cognito account (Cognito emails a temporary password), in the
#      `admin` group
#   2. the `usuarios` row with rol=admin, through the db-ops Lambda
#
#   scripts/create-admin.sh dev oasi-ti@economia.cl "Administrador OASI"
#
# Safe to re-run: an existing Cognito account is reused, and the row is
# upserted. Everyone after the first admin is created from the app
# (Administración → Usuarios).
#
source "$(dirname "$0")/lib.sh"
require_env "${1:-}"
STAGE="$1"
EMAIL="${2:?Uso: $0 <dev|prod> <email> \"<nombre>\"}"
NOMBRE="${3:?Uso: $0 <dev|prod> <email> \"<nombre>\"}"

cd "$(dirname "$0")/.."

# El pool puede venir de config.ts (ambiente que reusa uno existente, como
# dev) o del stack que lo creó (prod).
POOL="$(npx tsx -e "import {CONFIG} from './infra/config'; process.stdout.write(CONFIG.${STAGE}.cognito.existingUserPoolId ?? '')" 2>/dev/null)"
if [ -z "$POOL" ]; then
  POOL="$(stack_output "Oasi-Auth-${STAGE}" UserPoolId)"
fi
echo "==> User pool ${POOL}"

if aws cognito-idp admin-get-user --user-pool-id "$POOL" --username "$EMAIL" >/dev/null 2>&1; then
  echo "==> Cognito account already exists, reusing it"
  SIGN_IN_HINT="with the password you already have for this pool"
else
  SIGN_IN_HINT="with the temporary password from the email (you will be asked to change it)"
  echo "==> Creating Cognito account (an email with a temporary password is on its way)"
  aws cognito-idp admin-create-user \
    --user-pool-id "$POOL" \
    --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true Name=name,Value="$NOMBRE" \
    --desired-delivery-mediums EMAIL >/dev/null
fi

aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name admin

SUB="$(aws cognito-idp admin-get-user --user-pool-id "$POOL" --username "$EMAIL" \
  --query "UserAttributes[?Name=='sub'].Value" --output text)"

PAYLOAD="$(python3 -c 'import json,sys; print(json.dumps({"action":"create-admin","sub":sys.argv[1],"email":sys.argv[2],"nombre":sys.argv[3]}))' \
  "$SUB" "$EMAIL" "$NOMBRE")"

echo "==> Creating the usuarios row"
invoke_db_ops "$STAGE" "$PAYLOAD"
echo "==> Done. Sign in at the ${STAGE} site as ${EMAIL} ${SIGN_IN_HINT}."
