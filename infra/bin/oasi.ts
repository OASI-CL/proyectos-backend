#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { OasiStack } from '../lib/oasi-stack'

const app = new cdk.App()

/**
 * Stage comes from the CDK context so the same code deploys dev and prod:
 *   npx cdk deploy -c stage=dev
 *   npx cdk deploy -c stage=prod -c frontendOrigin=https://main.xxxx.amplifyapp.com
 *
 * On the very first deploy the Amplify URL does not exist yet — deploy
 * without frontendOrigin, create the Amplify app, then redeploy with it so
 * CORS stops being open.
 */
const stage = app.node.tryGetContext('stage') ?? 'dev'
const frontendOrigin = app.node.tryGetContext('frontendOrigin') as string | undefined

new OasiStack(app, `Oasi-${stage}`, {
  stage,
  frontendOrigin,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: `OASI ${stage}: permit tracking for investment projects`,
  tags: {
    Project: 'OASI',
    Stage: stage,
    ManagedBy: 'CDK',
  },
})
