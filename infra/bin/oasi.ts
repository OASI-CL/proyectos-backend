#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AuthStack } from '../lib/auth-stack'
import { OasiStack } from '../lib/oasi-stack'

const app = new cdk.App()

/**
 * Two stacks, on purpose:
 *
 *   Oasi-Auth-<stage>  Cognito only. Free (50k MAU) and all you need to build
 *                      and test the login.
 *   Oasi-<stage>       Everything else. Contains a NAT gateway (~US$32/mo,
 *                      not free tier), so deploy it when the API actually
 *                      needs to be up.
 *
 *   npx cdk deploy Oasi-Auth-dev -c stage=dev
 *   npx cdk deploy Oasi-dev      -c stage=dev
 *   npx cdk deploy --all         -c stage=prod -c frontendOrigin=https://...
 *
 * On the very first deploy the Amplify URL does not exist yet — deploy
 * without frontendOrigin, create the Amplify app, then redeploy with it so
 * CORS stops being open.
 */
const stage = app.node.tryGetContext('stage') ?? 'dev'
const frontendOrigin = app.node.tryGetContext('frontendOrigin') as string | undefined

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
}

const tags = {
  Project: 'OASI',
  Stage: stage,
  ManagedBy: 'CDK',
}

const auth = new AuthStack(app, `Oasi-Auth-${stage}`, {
  stage,
  env,
  description: `OASI ${stage}: Cognito user pool and roles`,
  tags,
})

new OasiStack(app, `Oasi-${stage}`, {
  stage,
  frontendOrigin,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  env,
  description: `OASI ${stage}: permit tracking for investment projects`,
  tags,
})
