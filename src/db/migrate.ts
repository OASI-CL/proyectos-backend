import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool, PoolClient } from 'pg'

/**
 * Database migrations, with a record of what has already been applied.
 *
 * One implementation, used everywhere:
 *   local   npm run db:migrate -- --env=local  (scripts/db-migrate.ts)
 *   AWS     npm run db:migrate -- --env=dev|prod, which invokes that
 *           environment's db-ops Lambda (src/ops/dbOps.ts). CI runs the same
 *           command after every deploy.
 *
 * The runner looks at the database and picks one of three paths:
 *
 *   fresh        no tables yet -> apply db/schema.sql (the full current
 *                model) and mark every file in db/migrations/ as applied,
 *                since schema.sql already contains all of them.
 *   baseline     tables exist but no _migrations table -> a database created
 *                before this runner existed. Mark every current migration as
 *                applied without running it: schema.sql and the migrations
 *                are kept in sync, so an existing database is assumed to be
 *                current. (Same idea as Flyway's baselineOnMigrate.)
 *   incremental  apply, in filename order, every migration not yet recorded.
 *
 * WRITING A NEW MIGRATION
 *   - name it NNN_description.sql, the next number in db/migrations/
 *   - do NOT put BEGIN/COMMIT in it: the runner wraps each file and its
 *     _migrations row in one transaction, so a failure leaves nothing
 *     half-applied and nothing recorded
 *   - apply the same change to db/schema.sql, so fresh databases get it too
 *   - no psql meta-commands (lines starting with a backslash): this runs
 *     through the pg driver, not psql
 *
 * (001 and 002 predate these rules and carry their own BEGIN/COMMIT. They
 * never run through here: every database that could need them is either
 * fresh or baselined.)
 */

const SQL_DIR = process.env.DB_SQL_DIR ?? path.join(__dirname, '..', '..', 'db')
const MIGRATIONS_DIR = path.join(SQL_DIR, 'migrations')
const SCHEMA_FILE = path.join(SQL_DIR, 'schema.sql')

/** Arbitrary constant: serializes concurrent runs (two deploys at once). */
const LOCK_KEY = 947_210_331

export interface MigrationResult {
  mode: 'fresh' | 'baseline' | 'incremental'
  applied: string[]
}

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [name])
  return rows[0].exists
}

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR)
  return entries.filter((f) => f.endsWith('.sql')).sort()
}

async function readSql(file: string): Promise<string> {
  const sql = await readFile(file, 'utf8')
  const metaCommand = sql.split('\n').find((line) => line.trimStart().startsWith('\\'))
  if (metaCommand) {
    throw new Error(`${path.basename(file)} contains a psql meta-command (${metaCommand.trim()}); remove it`)
  }
  return sql
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    nombre      TEXT PRIMARY KEY,
    aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`

async function record(client: PoolClient, files: string[]) {
  for (const file of files) {
    await client.query('INSERT INTO _migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [file])
  }
}

/**
 * The table used to be called `schema_migrations`. Rename it instead of
 * creating a second one, so a database that already has history keeps it and
 * does not re-run everything.
 */
async function renameLegacyTrackingTable(client: PoolClient) {
  const legacy = await tableExists(client, 'public.schema_migrations')
  const current = await tableExists(client, 'public._migrations')
  if (legacy && !current) {
    await client.query('ALTER TABLE schema_migrations RENAME TO _migrations')
  }
}

export async function runMigrations(pool: Pool, log: (msg: string) => void = console.log): Promise<MigrationResult> {
  const client = await pool.connect()
  let inTransaction = false

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])

    const files = await migrationFiles()
    await renameLegacyTrackingTable(client)
    const hasSchema = await tableExists(client, 'public.proyectos')
    const hasTracking = await tableExists(client, 'public._migrations')

    if (!hasSchema) {
      log('Empty database: applying db/schema.sql')
      const schema = await readSql(SCHEMA_FILE)
      await client.query('BEGIN')
      inTransaction = true
      await client.query(schema)
      await client.query(CREATE_TRACKING_TABLE)
      await record(client, files)
      await client.query('COMMIT')
      inTransaction = false
      return { mode: 'fresh', applied: ['schema.sql'] }
    }

    if (!hasTracking) {
      log(`Existing database without migration history: marking ${files.length} migration(s) as applied`)
      await client.query(CREATE_TRACKING_TABLE)
      await record(client, files)
      return { mode: 'baseline', applied: [] }
    }

    const { rows } = await client.query<{ nombre: string }>('SELECT nombre FROM _migrations')
    const done = new Set(rows.map((r) => r.nombre))
    const pending = files.filter((f) => !done.has(f))

    if (!pending.length) log('Database is up to date')

    for (const file of pending) {
      log(`Applying ${file}`)
      const sql = await readSql(path.join(MIGRATIONS_DIR, file))
      await client.query('BEGIN')
      inTransaction = true
      try {
        await client.query(sql)
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
      }
      await record(client, [file])
      await client.query('COMMIT')
      inTransaction = false
    }

    return { mode: 'incremental', applied: pending }
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined)
    client.release()
  }
}
