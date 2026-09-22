import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { Client } from 'pg'

/**
 * ============================================================================
 * BOOTSTRAP — crea las bases, los usuarios y los permisos de cada ambiente
 * ============================================================================
 *
 * Es la ÚNICA pieza que usa la credencial maestra del servidor RDS, y por eso
 * está separada de las Lambdas de cada ambiente: así la Lambda de dev nunca
 * tiene una credencial capaz de llegar a prod.
 *
 * Se invoca a mano una vez por servidor nuevo:
 *
 *   npm run db:bootstrap
 *
 * Es idempotente: correrla de nuevo no rompe nada y vuelve a aplicar los
 * permisos (sirve para reparar si alguien los cambió a mano).
 *
 * Lo que hace, por ambiente:
 *   1. crea el rol (usuario) de Postgres si no existe, con la contraseña del
 *      secreto de ese ambiente; si ya existe, la sincroniza
 *   2. crea la base con ese usuario como dueño
 *   3. le quita a PUBLIC todo permiso sobre la base — en Postgres, por
 *      defecto, CUALQUIER rol puede conectarse a CUALQUIER base, y eso es
 *      justamente lo que hay que cerrar
 *   4. le quita a este usuario el permiso de conectarse a las bases de los
 *      OTROS ambientes del mismo servidor
 *
 * Nada de esto puede ir dentro de una transacción: Postgres no permite
 * CREATE DATABASE dentro de una.
 * ============================================================================
 */

interface BootstrapTarget {
  env: string
  host: string
  port: string
  masterSecretArn: string
  userSecretArn: string
  databaseName: string
  databaseUser: string
  /** Otras bases del MISMO servidor, a las que este usuario no debe entrar. */
  otherDatabases: string[]
}

interface SecretValue {
  username?: string
  password?: string
}

let secrets: SecretsManagerClient | null = null

async function readSecret(arn: string): Promise<SecretValue> {
  secrets ??= new SecretsManagerClient({})
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: arn }))
  return JSON.parse(result.SecretString ?? '{}') as SecretValue
}

/**
 * Los nombres de base y de usuario vienen de config.ts, no de un request, así
 * que no hay entrada de usuario acá. Aun así se validan: un nombre de objeto
 * de Postgres no se puede pasar como parámetro ($1), hay que interpolarlo, y
 * una interpolación sin validar es una inyección esperando a pasar.
 */
function assertSafeIdentifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${what} inválido: "${value}". Solo minúsculas, números y guion bajo.`)
  }
  return value
}

/** Escapa una contraseña para incrustarla en un literal de Postgres. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Abre una conexión como usuario maestro a la base de mantenimiento. */
async function connectAsMaster(target: BootstrapTarget): Promise<Client> {
  const master = await readSecret(target.masterSecretArn)
  const client = new Client({
    host: target.host,
    port: Number(target.port),
    // 'postgres' y no la del ambiente: la del ambiente puede no existir aún.
    database: 'postgres',
    user: master.username,
    password: master.password,
    // RDS exige TLS y usa la CA de AWS, que no viene en el almacén de Node.
    // La conexión va cifrada y nunca sale de la VPC.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  })
  await client.connect()
  return client
}

/**
 * Pasada 1: el rol, la base y sus permisos.
 *
 * Va separada de la pasada 2 porque los REVOKE cruzados necesitan que TODAS
 * las bases existan; si se hiciera todo junto, al procesar dev se intentaría
 * revocar el acceso a la base de prod, que todavía no se creó.
 */
async function createRoleAndDatabase(target: BootstrapTarget): Promise<string[]> {
  const done: string[] = []

  const db = assertSafeIdentifier(target.databaseName, 'nombre de base')
  const user = assertSafeIdentifier(target.databaseUser, 'nombre de usuario')

  const master = await readSecret(target.masterSecretArn)
  const owner = await readSecret(target.userSecretArn)
  if (!owner.password) throw new Error(`El secreto de ${target.env} no tiene contraseña`)
  if (!master.username) throw new Error('El secreto maestro no tiene usuario')
  const masterUser = assertSafeIdentifier(master.username, 'usuario maestro')

  const client = await connectAsMaster(target)
  try {
    const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])
    if (roleExists.rowCount === 0) {
      await client.query(`CREATE ROLE ${user} LOGIN PASSWORD ${quoteLiteral(owner.password)}`)
      done.push(`rol ${user} creado`)
    } else {
      await client.query(`ALTER ROLE ${user} WITH LOGIN PASSWORD ${quoteLiteral(owner.password)}`)
      done.push(`rol ${user} ya existía, contraseña sincronizada`)
    }

    // En RDS el usuario maestro NO es superusuario: para crear una base cuyo
    // dueño es otro rol, primero tiene que ser miembro de ese rol. Sin esto
    // falla con "must be able to SET ROLE".
    await client.query(`GRANT ${user} TO ${masterUser}`)

    const dbExists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])
    if (dbExists.rowCount === 0) {
      await client.query(`CREATE DATABASE ${db} OWNER ${user}`)
      done.push(`base ${db} creada, dueño ${user}`)
    } else {
      await client.query(`ALTER DATABASE ${db} OWNER TO ${user}`)
      done.push(`base ${db} ya existía`)
    }

    // Cierra la puerta que Postgres deja abierta por defecto.
    await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`)
    await client.query(`GRANT ALL ON DATABASE ${db} TO ${user}`)
    done.push(`permisos de ${db}: solo ${user}`)
  } finally {
    await client.end()
  }

  return done
}

/**
 * Pasada 2: el aislamiento entre ambientes. A cada usuario se le niega
 * explícitamente conectarse a las bases de los OTROS ambientes del mismo
 * servidor. Corre cuando todas las bases ya existen.
 */
async function applyCrossRevokes(target: BootstrapTarget): Promise<string[]> {
  const done: string[] = []
  const user = assertSafeIdentifier(target.databaseUser, 'nombre de usuario')
  const others = target.otherDatabases.map((name) => assertSafeIdentifier(name, 'nombre de base'))
  if (others.length === 0) return done

  const client = await connectAsMaster(target)
  try {
    for (const other of others) {
      await client.query(`REVOKE CONNECT ON DATABASE ${other} FROM ${user}`)
      done.push(`${user} no puede conectarse a ${other}`)
    }
  } finally {
    await client.end()
  }

  return done
}

export async function handler() {
  const raw = process.env.BOOTSTRAP_TARGETS
  if (!raw) throw new Error('Falta BOOTSTRAP_TARGETS (lo setea el CDK)')

  const targets = JSON.parse(raw) as BootstrapTarget[]
  const result: Record<string, string[]> = {}

  // Primero todas las bases y usuarios...
  for (const target of targets) {
    result[target.env] = await createRoleAndDatabase(target)
  }
  // ...y solo entonces los permisos cruzados, que necesitan que todas existan.
  for (const target of targets) {
    result[target.env].push(...(await applyCrossRevokes(target)))
  }

  return result
}
