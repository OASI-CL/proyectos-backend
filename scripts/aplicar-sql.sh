#!/usr/bin/env bash
#
# Aplica en dev o prod un archivo SQL generado por:
#   db/seed_catalogos.py --solo-sql X.sql     (catálogos)
#   db/cargar_excel.py --file ...xlsx         (planilla; queda en data/cargas/)
#
#   scripts/aplicar-sql.sh dev  data/cargas/20260924_1530_carga.sql
#   scripts/aplicar-sql.sh prod data/cargas/20260924_1530_carga.sql
#
# Es el MISMO archivo que ya se aplicó en la base local: así local, dev y
# prod quedan iguales. Se aplica todo o nada (una transacción).
#
# Privacidad: el archivo trae datos de la planilla. Va al bucket privado y
# cifrado del ambiente, bajo ops/, y la Lambda lo borra apenas termina (una
# regla de ciclo de vida borra cualquier resto en un día). Nunca va a git.
#
source "$(dirname "$0")/lib.sh"
require_env "${1:-}"
STAGE="$1"
ARCHIVO="${2:-}"

if [ -z "$ARCHIVO" ] || [ ! -f "$ARCHIVO" ]; then
  echo "Uso: scripts/aplicar-sql.sh <dev|prod> <archivo.sql>" >&2
  exit 2
fi

BUCKET="$(stack_output "Oasi-Storage-${STAGE}" BucketName)"
KEY="ops/aplicar-$(date +%Y%m%d%H%M%S)-$(basename "$ARCHIVO")"

echo "==> Subiendo $(basename "$ARCHIVO") ($(du -h "$ARCHIVO" | cut -f1)) a s3://${BUCKET}/${KEY}"
aws s3 cp "$ARCHIVO" "s3://${BUCKET}/${KEY}" --sse AES256 --only-show-errors

echo "==> Aplicando en ${STAGE} (la Lambda borra el archivo de S3 al terminar)"
invoke_db_ops "$STAGE" "{\"action\":\"apply-sql\",\"key\":\"${KEY}\"}"
