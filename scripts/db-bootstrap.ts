import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

/**
 * npm run db:bootstrap
 *
 * Crea, en el servidor RDS, la base y el usuario de cada ambiente, y los
 * permisos que impiden que un ambiente entre al otro (ver
 * src/ops/dbBootstrap.ts). Se corre una vez, después de crear el servidor.
 *
 * Es idempotente: si se corre de nuevo, vuelve a aplicar los permisos.
 * Sirve para reparar si alguien los cambió a mano.
 *
 * Necesita credenciales de administrador (export AWS_PROFILE=oasi). El rol
 * con el que despliega GitHub NO puede invocar esta función: es la única que
 * tiene la credencial maestra del servidor.
 */
async function main() {
  const functionName = 'oasi-db-bootstrap'
  console.log(`Invocando ${functionName}...`)

  const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' })
  const response = await lambda.send(
    new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from('{}') }),
  )

  const payload = response.Payload ? Buffer.from(response.Payload).toString('utf8') : ''
  try {
    console.log(JSON.stringify(JSON.parse(payload), null, 2))
  } catch {
    console.log(payload)
  }

  if (response.FunctionError) {
    console.error(
      `\nFalló (${response.FunctionError}). Detalle en CloudWatch: /aws/lambda/${functionName}`,
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
