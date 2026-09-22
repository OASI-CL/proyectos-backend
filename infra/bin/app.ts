#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AccountStack } from '../lib/account-stack'
import { ApiStack } from '../lib/api-stack'
import { AuthStack } from '../lib/auth-stack'
import { DatabaseStack } from '../lib/database-stack'
import { NetworkStack } from '../lib/network-stack'
import { StorageStack } from '../lib/storage-stack'
import { CONFIG, SHARED, envConfig, sharedDatabaseNeeded, type EnvName } from '../config'

/**
 * ============================================================================
 * PUNTO DE ENTRADA — qué stacks existen y cómo se conectan
 * ============================================================================
 *
 * Compartidos por los dos ambientes (se despliegan una vez):
 *   Oasi-Account     acceso de GitHub por OIDC + aviso de presupuesto.
 *                    Se despliega A MANO, con credenciales de admin: define
 *                    los permisos con los que corre el CI, así que el CI no
 *                    puede modificarlo.
 *   Oasi-Network     la VPC y el NAT.
 *   Oasi-Database    el servidor RDS, los secretos y la Lambda de bootstrap.
 *
 * Por ambiente (dev y prod, iguales entre sí):
 *   Oasi-Auth-<env>      Cognito (solo si config.ts no trae un pool existente)
 *   Oasi-Storage-<env>   el bucket de adjuntos
 *   Oasi-Api-<env>       la Lambda de la API, el HTTP API y la Lambda de db-ops
 *
 * Están separados para que un cambio en la API no toque la base de datos.
 *
 * Cómo se usa:
 *   npx cdk synth                        ver las plantillas, no toca AWS
 *   npx cdk diff  --context env=dev      qué cambiaría un deploy
 *   npx cdk deploy --context env=dev --all
 *
 * El frontend (Amplify) NO está acá: conectarlo a GitHub por CDK exige
 * guardar un token de GitHub de larga vida. Se crea una vez por consola y
 * se configura con scripts/amplify-env.sh. Ver infra/README.md.
 * ============================================================================
 */
const app = new cdk.App()

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: SHARED.region }
const baseTags = { Project: 'OASI', ManagedBy: 'CDK' }

/**
 * `--context env=dev` deja en la app SOLO los stacks de dev (más los
 * compartidos), así `cdk deploy --all --context env=dev` no toca prod.
 * Sin ese contexto están los dos ambientes, para poder mirar todo junto con
 * `cdk synth` o `cdk diff`.
 */
const selectedEnv = app.node.tryGetContext('env') as string | undefined
const environments = (selectedEnv ? [envConfig(selectedEnv).envName] : (Object.keys(CONFIG) as EnvName[]))

// ----------------------------------------------------------------------------
// Compartidos
// ----------------------------------------------------------------------------

// Define los permisos con los que corre el CI, así que se despliega a mano y
// queda FUERA de la app cuando se elige un ambiente: si estuviera, un
// `deploy --all` del CI podría modificar sus propios permisos.
if (!selectedEnv) {
  new AccountStack(app, 'Oasi-Account', {
    env,
    description: 'OASI: acceso de GitHub por OIDC y aviso de presupuesto',
    tags: baseTags,
    terminationProtection: true,
  })
}

const network = new NetworkStack(app, 'Oasi-Network', {
  env,
  description: 'OASI: VPC compartida y NAT instance',
  tags: baseTags,
})

const database = sharedDatabaseNeeded() || hasDedicatedDatabase()
  ? new DatabaseStack(app, 'Oasi-Database', {
      env,
      description: 'OASI: servidor Postgres compartido, con una base aislada por ambiente',
      tags: baseTags,
      vpc: network.vpc,
      databaseSubnets: network.databaseSubnets,
      lambdaSubnets: network.lambdaSubnets,
      databaseSecurityGroup: network.databaseSecurityGroup,
      lambdaSecurityGroup: network.lambdaSecurityGroup,
    })
  : undefined

// ----------------------------------------------------------------------------
// Por ambiente
// ----------------------------------------------------------------------------
for (const envName of environments) {
  const config = envConfig(envName)
  const tags = { ...baseTags, Stage: envName }
  const isProd = envName === 'prod'

  // Cognito: se reusa el pool existente si config.ts trae sus ids; si no, se
  // crea uno nuevo en su propio stack.
  let cognitoIds: { userPoolId: string; userPoolClientId: string }

  if (config.cognito.existingUserPoolId && config.cognito.existingUserPoolClientId) {
    cognitoIds = {
      userPoolId: config.cognito.existingUserPoolId,
      userPoolClientId: config.cognito.existingUserPoolClientId,
    }
  } else {
    const auth = new AuthStack(app, `Oasi-Auth-${envName}`, {
      env,
      description: `OASI ${envName}: usuarios y roles en Cognito`,
      tags,
      terminationProtection: isProd,
      config,
    })
    cognitoIds = {
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
    }
  }

  const storage = new StorageStack(app, `Oasi-Storage-${envName}`, {
    env,
    description: `OASI ${envName}: bucket de adjuntos`,
    tags,
    terminationProtection: isProd,
    config,
  })

  new ApiStack(app, `Oasi-Api-${envName}`, {
    env,
    description: `OASI ${envName}: API (Lambda + HTTP API) y operaciones de base`,
    tags,
    terminationProtection: isProd,
    config,
    vpc: network.vpc,
    lambdaSubnets: network.lambdaSubnets,
    lambdaSecurityGroup: network.lambdaSecurityGroup,
    database: database?.targets[envName],
    bucket: storage.bucket,
    cognito: cognitoIds,
  })
}

function hasDedicatedDatabase(): boolean {
  return Object.values(CONFIG).some((c) => c.database.mode === 'dedicated')
}
