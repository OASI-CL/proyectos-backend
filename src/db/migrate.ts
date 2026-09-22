import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool, PoolClient } from 'pg'

/**
 * Database migrations, with a record of what has already been applied.
 *
 * One implementation, used everywhere:
 *   local   npm run db:migrate -- --env=local  (scripts/db.ts)
 *   AWS     npm run db:migrate -- --env=dev|prod, which invokes that
 *           environment's db-ops Lambda (src/ops/dbOps.ts). CI runs the same
 *           command after every deploy.
 *
 * The runner looks at the database and picks one of two paths:
 *
 *   fresh        no tables yet -> apply db/schema.sql (the full current
 *                model) and mark every file in db/migrations/ as applied,
 *                since schema.sql already contains all of them.
 *   incremental  apply, in filename order, every migration not yet recorded.
 *
 * Si la base tiene tablas pero NO tiene historial (`_migrations`), el runner
 * se DETIENE y pide un baseline explícito:
 *
 *   npm run db:baseline -- --env=local --hasta=002_catalogos.sql
 *
 * Antes eso se hacía solo, asumiendo que una base sin historial estaba al día.
 * Era peligroso: si había una migración nueva, quedaba marcada como aplicada
 * SIN ejecutarse, y la base se quedaba vieja en silencio. Pasó de verdad con
 * 003_comite_acumulado.sql. Ahora hay que declarar hasta dónde está la base.
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

/** Error con instrucciones, para una base que necesita baseline explícito. */
export class BaselineRequiredError extends Error {
  constructor(readonly files: string[]) {
    super(
      'La base tiene tablas pero no tiene historial de migraciones.\n' +
        'Declarás hasta dónde está al día con:\n' +
        `  npm run db:baseline -- --env=<ambiente> --hasta=<archivo>\n` +
        `Archivos disponibles: ${files.join(', ')}\n` +
        'Después corré db:migrate para aplicar las que falten.',
    )
    this.name = 'BaselineRequiredError'
  }
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

/**
 * Marca como aplicadas, sin ejecutarlas, todas las migraciones hasta `hasta`
 * (incluida). Es para una base que ya tiene ese estado — por ejemplo la que
 * se creó antes de que existiera el historial. Lo que venga después de
 * `hasta` queda pendiente y lo aplica db:migrate.
 */
export async function baselineMigrations(
  pool: Pool,
  hasta: string,
  log: (msg: string) => void = console.log,
): Promise<MigrationResult> {
  const files = await migrationFiles()
  const corte = files.indexOf(hasta)
  if (corte === -1) {
    throw new Error(`"${hasta}" no existe. Archivos disponibles: ${files.join(', ')}`)
  }

  const marcar = files.slice(0, corte + 1)
  const client = await pool.connect()
  try {
    await client.query(CREATE_TRACKING_TABLE)
    await record(client, marcar)
    log(`Marcadas como aplicadas (sin ejecutar): ${marcar.join(', ')}`)
    const pendientes = files.slice(corte + 1)
    if (pendientes.length) log(`Quedan pendientes: ${pendientes.join(', ')}`)
    return { mode: 'baseline', applied: marcar }
  } finally {
    client.release()
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

    // Base con tablas pero sin historial: no se puede adivinar hasta dónde
    // está al día, así que se pide declararlo (ver BaselineRequiredError).
    if (!hasTracking) throw new BaselineRequiredError(files)

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
