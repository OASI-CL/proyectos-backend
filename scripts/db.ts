import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

/**
 * ============================================================================
 * Comandos de base de datos — una sola puerta de entrada
 * ============================================================================
 *
 *   npm run db:migrate -- --env=local|dev|prod   aplica las migraciones pendientes
 *   npm run db:status  -- --env=dev|prod         migraciones aplicadas y filas por tabla
 *   npm run db:check   -- --env=dev|prod         prueba que este ambiente no
 *                                                pueda abrir la base del otro
 *   npm run db:bootstrap                         crea las bases y los usuarios
 *                                                de todos los ambientes (una vez)
 *
 * Por qué no se conecta directo a la base de AWS: vive en una red sin entrada
 * ni salida a internet, así que tu PC no tiene ruta hacia ella. En vez de
 * abrir un túnel (o de exponer la base), estos comandos le piden a una Lambda
 * que ya está adentro de esa red que haga el trabajo. El resultado se imprime
 * igual, y en el caso de las migraciones es el mismo código que corre en los
 * dos lados (src/db/migrate.ts).
 *
 * Todo lo que toca AWS necesita credenciales: export AWS_PROFILE=oasi
 * ============================================================================
 */

type Comando = 'migrate' | 'status' | 'check' | 'bootstrap' | 'baseline' | 'wipe'
type Ambiente = 'local' | 'dev' | 'prod'

const USO = `Uso:
  npm run db:migrate  -- --env=local|dev|prod
  npm run db:status   -- --env=dev|prod
  npm run db:check    -- --env=dev|prod
  npm run db:bootstrap
  npm run db:baseline -- --env=local --hasta=002_catalogos.sql
      (solo para una base que ya tiene ese estado y no tiene historial:
       marca como aplicadas las migraciones hasta ese archivo, sin correrlas)
  npm run db:wipe -- --env=dev|prod --confirm
      (DESTRUCTIVO: vacía todo menos catálogos y usuarios, para empezar de
       cero. La carga normal de cada planilla NO lo necesita: es incremental.
       Después: scripts/aplicar-sql.sh con catálogos y planilla)`

const comando = process.argv[2] as Comando | undefined
const ambiente = process.argv.slice(3).find((a) => a.startsWith('--env='))?.split('=')[1] as
  | Ambiente
  | undefined

function lambda() {
  // La región explícita: el .env del proyecto trae AWS_REGION vacío para el
  // backend local, y si se colara acá el SDK fallaría con region="".
  return new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' })
}

/** Invoca una Lambda y devuelve lo que imprimió; falla si la Lambda falló. */
async function invocar(functionName: string, payload: unknown) {
  console.log(`Invocando ${functionName}...`)
  const respuesta = await lambda().send(
    new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify(payload)) }),
  )

  const texto = respuesta.Payload ? Buffer.from(respuesta.Payload).toString('utf8') : ''
  try {
    console.log(JSON.stringify(JSON.parse(texto), null, 2))
  } catch {
    console.log(texto)
  }

  if (respuesta.FunctionError) {
    console.error(
      `\nFalló (${respuesta.FunctionError}). Log completo en CloudWatch: /aws/lambda/${functionName}`,
    )
    process.exit(1)
  }
}

/** Migra la base local del .env, sin pasar por AWS. */
async function migrarLocal() {
  // El .env se carga SOLO acá, a propósito: trae variables AWS_* vacías que,
  // si se cargaran siempre, romperían los comandos que sí hablan con AWS.
  await import('dotenv/config')
  const { pool } = await import('../src/db/client.js')
  const { runMigrations } = await import('../src/db/migrate.js')
  try {
    console.log(JSON.stringify(await runMigrations(pool), null, 2))
  } finally {
    await pool.end()
  }
}

async function baselineLocal(hasta: string) {
  await import('dotenv/config')
  const { pool } = await import('../src/db/client.js')
  const { baselineMigrations } = await import('../src/db/migrate.js')
  try {
    console.log(JSON.stringify(await baselineMigrations(pool, hasta), null, 2))
  } finally {
    await pool.end()
  }
}

function exigirAmbienteAws(): 'dev' | 'prod' {
  if (ambiente !== 'dev' && ambiente !== 'prod') {
    console.error(`Falta --env=dev o --env=prod\n\n${USO}`)
    process.exit(2)
  }
  return ambiente
}

async function main() {
  switch (comando) {
    case 'migrate':
      if (ambiente === 'local') return migrarLocal()
      return invocar(`oasi-db-ops-${exigirAmbienteAws()}`, { action: 'migrate' })

    case 'status':
      return invocar(`oasi-db-ops-${exigirAmbienteAws()}`, { action: 'status' })

    case 'check':
      return invocar(`oasi-db-ops-${exigirAmbienteAws()}`, { action: 'check-isolation' })

    // Sin --env: crea de una vez las bases y los usuarios de TODOS los
    // ambientes, porque los permisos cruzados necesitan que todas existan.
    // Es la única Lambda con la credencial maestra del servidor.
    case 'wipe': {
      const confirmar = process.argv.slice(3).includes('--confirm')
      if (!confirmar) {
        console.error(`Falta --confirm. Esto borra los datos de ${ambiente ?? '<env>'} sin vuelta atrás.\n\n${USO}`)
        process.exit(2)
      }
      return invocar(`oasi-db-ops-${exigirAmbienteAws()}`, { action: 'wipe-data', confirm: true })
    }

    case 'bootstrap':
      return invocar('oasi-db-bootstrap', {})

    case 'baseline': {
      const hasta = process.argv.slice(3).find((a) => a.startsWith('--hasta='))?.split('=')[1]
      if (!hasta) {
        console.error(`Falta --hasta=<archivo>\n\n${USO}`)
        process.exit(2)
      }
      if (ambiente === 'local') return baselineLocal(hasta)
      return invocar(`oasi-db-ops-${exigirAmbienteAws()}`, { action: 'baseline', hasta })
    }

    default:
      console.error(USO)
      process.exit(2)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
