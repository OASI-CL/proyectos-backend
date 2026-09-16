import { Pool, types } from 'pg'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

// ----------------------------------------------------------------------------
// Type parsers
//
// By default `pg` returns:
//   - DATE  -> a JS Date (which serialises to a timestamp with a timezone,
//              e.g. "2016-06-21T04:00:00.000Z")
//   - BIGINT and NUMERIC -> strings (to avoid losing precision)
//
// The API has to return ISO YYYY-MM-DD dates and numbers as numbers (see
// shared/types.ts), so we adjust them here, once.
// ----------------------------------------------------------------------------

types.setTypeParser(types.builtins.DATE, (valor) => valor) // 'YYYY-MM-DD' as-is
types.setTypeParser(types.builtins.INT8, (valor) => parseInt(valor, 10))
types.setTypeParser(types.builtins.NUMERIC, (valor) => parseFloat(valor))

// ----------------------------------------------------------------------------
// Credentials
//
// Locally the password comes from .env. On AWS it lives in Secrets Manager
// (CDK generates it and never puts it in an env var), so we resolve it lazily:
// `pg` accepts an async function for `password` and calls it per connection,
// and the value is cached so we hit Secrets Manager once per Lambda cold
// start, not once per query.
// ----------------------------------------------------------------------------

let cachedPassword: string | null = null

async function resolvePassword(): Promise<string> {
  if (cachedPassword !== null) return cachedPassword

  const secretArn = process.env.DB_SECRET_ARN
  if (!secretArn) {
    cachedPassword = process.env.DB_PASSWORD ?? ''
    return cachedPassword
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION })
  const secret = await client.send(new GetSecretValueCommand({ SecretId: secretArn }))
  const parsed = JSON.parse(secret.SecretString ?? '{}') as { password?: string }

  cachedPassword = parsed.password ?? ''
  return cachedPassword
}

// pg connection pool. Do NOT use the RDS Data API (see claude_instructions.md).
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: resolvePassword,
  // t3.micro: keep the pool small. On Lambda each warm container holds its
  // own pool, so a large max here multiplies across concurrent containers and
  // exhausts the instance's connection limit.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // RDS enforces TLS; it uses the AWS-managed CA, which is not in Node's
  // default trust store, so verification is relaxed for that hop only. The
  // connection is still encrypted and never leaves the VPC.
  ssl: process.env.DB_SECRET_ARN ? { rejectUnauthorized: false } : undefined,
})
