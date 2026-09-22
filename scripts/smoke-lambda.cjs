#!/usr/bin/env node
/*
 * Smoke test of the BUILT Lambda bundle (dist-lambda/), before it is deployed.
 *
 *   npm run build:lambda && npm run test:lambda
 *
 * `npm run dev` runs the TypeScript sources with every devDependency around;
 * the Lambda runs compiled JS with production dependencies only. This catches
 * the class of bug that only exists in the second: a dependency that ended up
 * in devDependencies, a bad require path, a SQL file missing from the bundle.
 * CI runs it before every deploy. No AWS or database needed.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const os = require('node:os')

const source = path.join(__dirname, '..', 'dist-lambda')
process.env.NODE_ENV = 'production'
process.env.AUTH_MODE = 'cognito'
// Como en AWS: el HTTP API tiene un stage con nombre, y la ruta que recibe la
// Lambda lo incluye (/smoke/health). Si el handler no lo quita, Express
// responde 404 a todo — pasó de verdad, por eso el test lo cubre.
process.env.API_STAGE = 'smoke'

async function main() {
  assert.ok(fs.existsSync(source), 'dist-lambda/ not found: run npm run build:lambda first')

  // Run from a copy outside the repo. Inside it, Node's module resolution
  // would walk up to the repo's own node_modules and quietly find a
  // dependency the bundle is missing — the exact bug this test exists for.
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'oasi-lambda-'))
  fs.cpSync(source, bundle, { recursive: true })

  // 1. The API handler loads and answers through the API Gateway adapter.
  //    Event shape: HTTP API (payload format 2.0), which is what
  //    infra/lib/api-stack.ts provisions. It differs from the REST API 1.0
  //    shape, so this is also what catches an adapter/format mismatch.
  const { handler: api } = require(path.join(bundle, 'handler.js'))
  const response = await api(
    {
      version: '2.0',
      routeKey: '$default',
      rawPath: '/smoke/health',
      rawQueryString: '',
      headers: { origin: 'https://not-allowed.example' },
      requestContext: {
        accountId: '000000000000',
        apiId: 'smoke',
        domainName: 'smoke.execute-api.us-east-1.amazonaws.com',
        http: {
          method: 'GET',
          path: '/smoke/health',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'smoke-test',
        },
        requestId: 'smoke',
        routeKey: 'ANY /{proxy+}',
        stage: 'smoke',
        time: '01/Jan/2026:00:00:00 +0000',
        timeEpoch: 1767225600000,
      },
      pathParameters: { proxy: 'health' },
      isBase64Encoded: false,
    },
    { callbackWaitsForEmptyEventLoop: false },
  )
  assert.equal(response.statusCode, 200, `/health answered ${response.statusCode}: ${response.body}`)
  assert.equal(JSON.parse(response.body).authMode, 'cognito')

  // A deployed API with no configured origins must not echo arbitrary ones.
  const allowOrigin = response.headers?.['access-control-allow-origin'] ?? response.multiValueHeaders?.['access-control-allow-origin']
  assert.ok(!allowOrigin, `CORS is open in production mode: ${allowOrigin}`)
  console.log('ok  api handler: GET /health -> 200, CORS closed')

  // 2. The db-ops handler loads.
  const dbOps = require(path.join(bundle, 'src', 'ops', 'dbOps.js'))
  assert.equal(typeof dbOps.handler, 'function')
  console.log('ok  db-ops handler loads')

  // 3. The SQL the migration runner reads is inside the bundle.
  const migrations = fs.readdirSync(path.join(bundle, 'db', 'migrations')).filter((f) => f.endsWith('.sql'))
  assert.ok(migrations.length > 0, 'db/migrations missing from bundle')
  console.log(`ok  SQL bundled: ${migrations.length} migration(s)`)

  process.exit(0) // the pg pool would otherwise keep the process alive
}

main().catch((err) => {
  console.error('FAIL', err.message)
  process.exit(1)
})
