#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AccountStack } from '../lib/account-stack'
import { AuthStack } from '../lib/auth-stack'
import { OasiStack } from '../lib/oasi-stack'
import { stageConfig } from '../lib/config'

/**
 * Stacks:
 *
 *   Oasi-Account        once per AWS account, by hand: GitHub OIDC, deploy
 *                       roles, cost budget.
 *   Oasi-Auth-<stage>   Cognito user pool for that environment.
 *   Oasi-<stage>        VPC, RDS, Lambdas, API Gateway, S3, alarms.
 *
 *   npx cdk deploy Oasi-Account
 *   npx cdk deploy Oasi-Auth-dev  Oasi-dev  -c stage=dev
 *   npx cdk deploy Oasi-Auth-prod Oasi-prod -c stage=prod
 *
 * CI (.github/workflows/deploy.yml) deploys the stage stacks; it never
 * touches Oasi-Account, which defines CI's own permissions.
 */
const app = new cdk.App()

const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'dev'
const config = stageConfig(stage)

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
}

new AccountStack(app, 'Oasi-Account', {
  env,
  description: 'OASI account-wide: GitHub OIDC deploy roles and cost budget',
  tags: { Project: 'OASI', ManagedBy: 'CDK' },
  terminationProtection: true,
})

const tags = { Project: 'OASI', Stage: stage, ManagedBy: 'CDK' }
const isProd = stage === 'prod'

const auth = new AuthStack(app, `Oasi-Auth-${stage}`, {
  stage,
  env,
  description: `OASI ${stage}: Cognito user pool and roles`,
  tags,
  terminationProtection: isProd,
})

new OasiStack(app, `Oasi-${stage}`, {
  stage,
  config,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  env,
  description: `OASI ${stage}: permit tracking for investment projects`,
  tags,
  terminationProtection: isProd,
})
