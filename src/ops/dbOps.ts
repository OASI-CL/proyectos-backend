import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { pool } from '../db/client'
import { runMigrations } from '../db/migrate'

/**
 * db-ops Lambda: the only way anything outside the VPC touches the database.
 *
 * RDS sits in isolated subnets with no public address, so instead of opening
 * a tunnel, this function runs inside the VPC and does the few operational
 * tasks that need direct access. It has no HTTP endpoint; it can only be
 * invoked with IAM credentials (the GitHub deploy role, or an admin's CLI).
 *
 *   {"action":"status"}                          applied migrations + row counts
 *   {"action":"migrate"}                         see src/db/migrate.ts
 *   {"action":"check-isolation"}                 proves this environment's
 *                                                credentials cannot open the
 *                                                other environment's database
 *   {"action":"load-data","key":"ops/x.sql"}     one-time load of the historical data
 *   {"action":"create-admin","sub":"…","email":"…","nombre":"…"}
 *
 * Wrapped by npm run db:* (scripts/db.ts), scripts/load-data.sh, scripts/create-admin.sh.
 * A thrown error surfaces as a failed invocation, which makes those scripts
 * and the CI step exit non-zero.
 */

type DbOpsEvent =
  | { action: 'status' }
  | { action: 'migrate' }
  | { action: 'check-isolation' }
  | { action: 'load-data'; key: string }
  | { action: 'create-admin'; sub: string; email: string; nombre: string }

/** Tables the historical data load fills. Catalogs come with schema.sql. */
const DATA_TABLES = ['empresas', 'proyectos', 'permisos', 'comites', 'permisos_comite']

let s3: S3Client | null = null

export async function handler(event: DbOpsEvent) {
  switch (event.action) {
    case 'status':
      return status()
    case 'migrate':
      return runMigrations(pool)
    case 'check-isolation':
      return checkIsolation()
    case 'load-data':
      return loadData(event.key)
    case 'create-admin':
      return createAdmin(event)
    default:
      throw new Error(`Unknown action: ${JSON.stringify(event)}`)
  }
}

async function status() {
  const tracking = await pool.query("SELECT to_regclass('public._migrations') IS NOT NULL AS exists")
  const migrations = tracking.rows[0].exists
    ? (await pool.query('SELECT nombre, aplicada_at FROM _migrations ORDER BY nombre')).rows
    : []

  const hasSchema = (await pool.query("SELECT to_regclass('public.proyectos') IS NOT NULL AS exists")).rows[0].exists
  const counts: Record<string, number> = {}
  if (hasSchema) {
    for (const table of [...DATA_TABLES, 'usuarios']) {
      counts[table] = (await pool.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n
    }
  }
  return { migrations, counts }
}

/**
 * Prueba, de verdad, que las credenciales de ESTE ambiente no puedan abrir la
 * base de los otros. No alcanza con haber corrido los REVOKE: esto intenta la
 * conexión y espera que falle.
 *
 * `npm run db:check -- --env=dev`
 */
async function checkIsolation() {
  const others = (process.env.OTHER_DATABASES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!others.length) return { checked: [], note: 'No hay otras bases en este servidor' }

  // Las credenciales salen del mismo lugar que usa la app, así que esto prueba
  // exactamente lo que pasaría si alguien usara este ambiente para llegar al otro.
  const { Client } = await import('pg')
  const checked: { database: string; connected: boolean; error?: string }[] = []

  for (const database of others) {
    const client = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
      database,
      user: process.env.DB_USER,
      password: await currentPassword(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    })
    try {
      await client.connect()
      await client.end()
      checked.push({ database, connected: true })
    } catch (err) {
      checked.push({ database, connected: false, error: (err as Error).message })
    }
  }

  const leaked = checked.filter((c) => c.connected)
  if (leaked.length) {
    throw new Error(
      `AISLAMIENTO ROTO: ${process.env.DB_USER} pudo conectarse a ${leaked
        .map((l) => l.database)
        .join(', ')}`,
    )
  }
  return { ok: true, usuario: process.env.DB_USER, checked }
}

/** La misma contraseña que usa el pool de la app, desde Secrets Manager. */
async function currentPassword(): Promise<string> {
  const arn = process.env.DB_SECRET_ARN
  if (!arn) return process.env.DB_PASSWORD ?? ''
  const { GetSecretValueCommand, SecretsManagerClient } = await import(
    '@aws-sdk/client-secrets-manager'
  )
  const sm = new SecretsManagerClient({})
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  return (JSON.parse(secret.SecretString ?? '{}') as { password?: string }).password ?? ''
}

/**
 * Loads a data-only SQL dump (made by scripts/load-data.sh from a local
 * database) into an environment that has the schema but no data yet.
 *
 * Refuses to run on a database that already holds projects: this is for the
 * first load, not a sync, and running it twice would duplicate or clash.
 * The dump is deleted from S3 afterwards, whatever the outcome — it holds
 * private data and has no reason to outlive the load.
 */
async function loadData(key: string) {
  if (!key?.startsWith('ops/')) throw new Error('key must be under ops/')

  const bucket = process.env.S3_BUCKET_ADJUNTOS
  if (!bucket) throw new Error('S3_BUCKET_ADJUNTOS is not set')
  s3 ??= new S3Client({})

  try {
    const existing = (await pool.query('SELECT count(*)::int AS n FROM public.proyectos')).rows[0].n
    if (existing > 0) {
      throw new Error(`The database already has ${existing} projects; load-data only runs on an empty one`)
    }

    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const sql = await object.Body!.transformToString('utf-8')

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      // Rows keep their original ids, so move each sequence past them or the
      // next INSERT from the app collides with an existing id.
      for (const table of DATA_TABLES) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'),
                         GREATEST((SELECT COALESCE(max(id), 0) FROM public.${table}), 1),
                         (SELECT count(*) > 0 FROM public.${table}))`,
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      // The dump may have changed session settings; never hand this
      // connection back to the pool.
      client.release(true)
    }

    return status()
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)
  }
}

/**
 * The `usuarios` half of the very first admin of an environment. The Cognito
 * half (the account itself) is created by scripts/create-admin.sh with the
 * AWS CLI, which then passes the account's `sub` here. Every later user is
 * created from the app.
 */
async function createAdmin({ sub, email, nombre }: { sub: string; email: string; nombre: string }) {
  if (!sub || !email || !nombre) throw new Error('sub, email and nombre are required')

  const { rows } = await pool.query(
    `INSERT INTO usuarios (cognito_sub, nombre, email, rol, created_by, updated_by)
     VALUES ($1, $2, $3, 'admin', 'bootstrap', 'bootstrap')
     ON CONFLICT (cognito_sub) DO UPDATE
       SET rol = 'admin', nombre = EXCLUDED.nombre, email = EXCLUDED.email,
           empresa_id = NULL, organismo_id = NULL, region_id = NULL,
           updated_by = 'bootstrap'
     RETURNING id, nombre, email, rol`,
    [sub, nombre, email],
  )
  return rows[0]
}
