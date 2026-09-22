#!/usr/bin/env bash
#
# Arma el paquete que se sube a Lambda, en dist-lambda/.
#
# Es la ÚNICA carpeta de build del proyecto. Contiene tres cosas:
#   - el código compilado a JavaScript (src/ y handler.js)
#   - node_modules solo con las dependencias de producción, porque el código
#     compilado sigue haciendo require('express'), require('pg')...
#   - una copia de db/*.sql, porque la Lambda que migra la base los lee en
#     tiempo de ejecución
#
# Revisá el resultado con `npm run test:lambda` antes de desplegar.
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Compilando TypeScript directo a dist-lambda/"
rm -rf dist-lambda
npx tsc -p tsconfig.json --outDir dist-lambda

echo "==> Copiando los .sql que la Lambda lee en tiempo de ejecución"
mkdir -p dist-lambda/db
cp db/schema.sql dist-lambda/db/
cp -r db/migrations dist-lambda/db/

echo "==> Instalando dependencias de producción"
cp package.json package-lock.json dist-lambda/
(
  cd dist-lambda
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  # Lo que nunca corre en Lambda.
  rm -rf node_modules/.cache node_modules/.bin scripts
  rm -f package.json package-lock.json
)

echo "==> Listo: $(du -sh dist-lambda | cut -f1) en dist-lambda/"
