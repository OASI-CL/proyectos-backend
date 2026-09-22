import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

/**
 * ============================================================================
 * npm run db:migrate -- --env=local|dev|prod
 * ============================================================================
 *
 *   --env=local   aplica las migraciones al Postgres de tu PC (el del .env)
 *   --env=dev     aplica las migraciones a la base de dev en AWS
 *   --env=prod    idem prod
 *
 * Por qué dev y prod no se conectan directo: la base de AWS vive en una red
 * sin salida ni entrada a internet, así que tu PC no tiene ruta hacia ella.
 * En vez de abrir un túnel (o de exponer la base), el comando le pide a una
 * Lambda que ya está adentro de esa red que aplique las migraciones. El
 * resultado se imprime igual, y es el mismo código corriendo en los dos
 * casos (src/db/migrate.ts).
 *
 * Necesita credenciales de AWS para dev y prod (export AWS_PROFILE=oasi).
 * ============================================================================
 */

const arg = process.argv.slice(2).find((a) => a.startsWith('--env='))
const target = arg?.split('=')[1]

if (target !== 'local' && target !== 'dev' && target !== 'prod') {
  console.error('Uso: npm run db:migrate -- --env=local|dev|prod')
  process.exit(2)
}

async function migrateLocal() {
  // El .env se carga SOLO acá, a propósito: trae variables AWS_* vacías (para
  // el backend local) que, si se cargaran siempre, pisarían la región del
  // perfil de AWS y romperían el camino remoto con `region=""`.
  await import('dotenv/config')
  // Import dinámico: así el camino de AWS no necesita conexión a Postgres ni
  // abre un pool que después quede colgado.
  const { pool } = await import('../src/db/client.js')
  const { runMigrations } = await import('../src/db/migrate.js')
  try {
    const result = await runMigrations(pool)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await pool.end()
  }
}

async function migrateRemote(env: 'dev' | 'prod') {
  const functionName = `oasi-db-ops-${env}`
  console.log(`Invocando ${functionName} (accion: migrate)...`)

  const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' })
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify({ action: 'migrate' })),
    }),
  )

  const payload = response.Payload ? Buffer.from(response.Payload).toString('utf8') : ''
  console.log(payload)

  if (response.FunctionError) {
    console.error(
      `\nLa Lambda falló (${response.FunctionError}). El detalle completo está en ` +
        `CloudWatch: /aws/lambda/${functionName}`,
    )
    process.exit(1)
  }
}

const run = target === 'local' ? migrateLocal() : migrateRemote(target)

run.catch((err) => {
  console.error(err)
  process.exit(1)
})
