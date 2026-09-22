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
 * Compartidos por los dos ambientes:
 *   Oasi-Account     acceso de GitHub por OIDC + aviso de presupuesto.
 *                    Se despliega A MANO, con credenciales de admin. No hace
 *                    falta excluirlo de nada: como nunca se lo nombra en un
 *                    `cdk deploy <stacks>` del CI, nunca lo toca el CI, esté
 *                    o no presente en la app.
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
 * ---------------------------------------------------------------------------
 * LOS OCHO STACKS SE INSTANCIAN SIEMPRE, PARA LOS DOS AMBIENTES A LA VEZ
 * ---------------------------------------------------------------------------
 * Antes esto se filtraba con `--context env=dev|prod`, dejando fuera de la
 * app los stacks del otro ambiente. Se sacó a propósito: `Oasi-Database` es
 * compartida por dev y prod, y CDK calcula automáticamente qué exportar entre
 * stacks mirando TODA la app que tiene synthesizada en ese momento. Con el
 * filtro, un deploy de "solo prod" no sabía que `Oasi-Api-dev` seguía
 * existiendo de verdad en AWS y usando un secreto de `Oasi-Database` — CDK
 * daba de baja esa exportación, y CloudFormation frenaba todo con
 * "cannot delete export ... as it is in use by Oasi-Api-dev" (pasó de
 * verdad). La app ahora siempre ve el estado completo; lo que decide qué se
 * toca es a cuáles stacks se les pasa el NOMBRE en `cdk deploy`, no cuáles
 * existen en el código.
 *
 * Cómo se usa:
 *   npx cdk synth                               ver todas las plantillas, no toca AWS
 *   npx cdk diff  Oasi-Api-dev Oasi-Database     qué cambiaría, solo para esos stacks
 *   npx cdk deploy Oasi-Network Oasi-Database Oasi-Auth-dev Oasi-Storage-dev Oasi-Api-dev
 *
 * El frontend (Amplify) NO está acá: conectarlo a GitHub por CDK exige
 * guardar un token de GitHub de larga vida. Se crea una vez por consola y
 * se configura con scripts/amplify-env.sh. Ver infra/README.md.
 * ============================================================================
 */
const app = new cdk.App()

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: SHARED.region }
const baseTags = { Project: 'OASI', ManagedBy: 'CDK' }
const environments = Object.keys(CONFIG) as EnvName[]

// ----------------------------------------------------------------------------
// Compartidos
// ----------------------------------------------------------------------------

new AccountStack(app, 'Oasi-Account', {
  env,
  description: 'OASI: acceso de GitHub por OIDC y aviso de presupuesto',
  tags: baseTags,
  terminationProtection: true,
})

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
