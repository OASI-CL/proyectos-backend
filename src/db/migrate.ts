import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool, PoolClient } from 'pg'

/**
 * ============================================================================
 * Aplicador de migraciones
 * ============================================================================
 *
 * Una sola implementación, usada en los dos lados:
 *   local   npm run db:migrate -- --env=local        (scripts/db.ts)
 *   AWS     npm run db:migrate -- --env=dev|prod, que invoca la Lambda
 *           db-ops del ambiente (src/ops/dbOps.ts). El CI corre lo mismo
 *           después de cada deploy.
 *
 * `db/migrations/` es la ÚNICA fuente de verdad del estado de la base. Una
 * base vacía se construye corriendo todas las migraciones en orden; ya no
 * existe un `schema.sql` que se aplique aparte. (Antes existía, y había que
 * escribir cada cambio dos veces: si alguien se olvidaba de una, una base
 * nueva y una migrada quedaban distintas en silencio.)
 *
 * Los archivos los escribe drizzle-kit a partir de los modelos de
 * `src/db/schema/`:
 *
 *   npm run db:generate          escribe el SQL de lo que cambió en el modelo
 *   npm run db:generate:custom   crea una migración vacía para SQL a mano
 *                                (vistas, triggers, datos de catálogos)
 *
 * Si la base tiene tablas pero NO tiene historial (`_migrations`), el runner
 * se DETIENE y pide declarar hasta dónde está al día:
 *
 *   npm run db:baseline -- --env=local --hasta=0002_triggers_vistas_catalogos.sql
 *
 * Antes eso se hacía solo, asumiendo que una base sin historial estaba al día.
 * Era peligroso: si había una migración nueva, quedaba marcada como aplicada
 * SIN ejecutarse y la base se quedaba vieja sin que nada avisara. Pasó de
 * verdad con el cambio del conteo por comité.
 *
 * REGLAS PARA UNA MIGRACIÓN NUEVA
 *   - se genera con `npm run db:generate` después de editar un modelo; a mano
 *     solo las que un modelo no puede expresar
 *   - sin BEGIN/COMMIT adentro: el runner envuelve cada archivo y su registro
 *     en una transacción, así un error no deja nada a medias
 *   - sin comandos de psql (líneas que empiezan con barra invertida): esto
 *     corre por el driver de Postgres, no por psql
 *   - una migración ya aplicada NO se edita nunca: se escribe otra
 */

const SQL_DIR = process.env.DB_SQL_DIR ?? path.join(__dirname, '..', '..', 'db')
const MIGRATIONS_DIR = path.join(SQL_DIR, 'migrations')

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
    // Limpia registros de archivos que ya no existen (por ejemplo migraciones
    // viejas que se aplastaron en una inicial): el historial tiene que hablar
    // de los archivos que hay hoy, no de los que hubo.
    await client.query('DELETE FROM _migrations WHERE nombre <> ALL($1::text[])', [files])
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
    const tieneTablas = await tableExists(client, 'public.proyectos')
    const tieneHistorial = await tableExists(client, 'public._migrations')

    // Base con tablas pero sin historial: no se puede adivinar hasta dónde
    // está al día, así que se pide declararlo (ver BaselineRequiredError).
    if (tieneTablas && !tieneHistorial) throw new BaselineRequiredError(files)

    await client.query(CREATE_TRACKING_TABLE)

    const { rows } = await client.query<{ nombre: string }>('SELECT nombre FROM _migrations')
    const done = new Set(rows.map((r) => r.nombre))
    const pending = files.filter((f) => !done.has(f))

    if (!pending.length) log('La base está al día')
    else if (!tieneTablas) log(`Base vacía: aplicando las ${pending.length} migraciones`)

    for (const file of pending) {
      log(`Aplicando ${file}`)
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

    return { mode: tieneTablas ? 'incremental' : 'fresh', applied: pending }
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined)
    client.release()
  }
}
