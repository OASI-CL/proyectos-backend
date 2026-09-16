#!/usr/bin/env bash
#
# Builds the Lambda deployment package into dist-lambda/.
#
# Why not just zip dist/: the compiled JS still does `require('express')`,
# `require('pg')`, ... so the runtime dependencies have to travel with it.
# We install them fresh with --omit=dev so devDependencies stay out.
#
# Check the result with `npm run test:lambda` before deploying.
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Compiling TypeScript"
rm -rf dist
npm run build

echo "==> Preparing dist-lambda/"
rm -rf dist-lambda
mkdir -p dist-lambda

# tsc emits dist/handler.js + dist/src/**. The handler requires './src/app',
# so the layout has to be preserved as-is.
cp -r dist/handler.js dist/handler.js.map dist/src dist-lambda/

# The migration runner (db-ops Lambda) reads these at runtime.
mkdir -p dist-lambda/db
cp db/schema.sql dist-lambda/db/
cp -r db/migrations dist-lambda/db/

echo "==> Installing production dependencies"
cp package.json package-lock.json dist-lambda/
(
  cd dist-lambda
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  # Trim what never runs in Lambda.
  rm -rf node_modules/.cache node_modules/.bin
  rm -f package.json package-lock.json
)

echo "==> Done: $(du -sh dist-lambda | cut -f1) in dist-lambda/"
