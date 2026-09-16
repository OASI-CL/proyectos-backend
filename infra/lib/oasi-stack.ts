import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import type { StageConfig } from './config'

/**
 * NAT instance setup: CDK's default commands, with two fixes.
 *
 * - A 1 GB swap file first. On a t4g.nano (0.5 GB RAM) `dnf install` gets
 *   OOM-killed while loading repository metadata; the default script then
 *   carries on without iptables, and the instance forwards nothing — every
 *   Lambda loses internet access (Secrets Manager, Cognito) with no error
 *   anywhere except a DB connection timeout.
 * - The outbound interface from `ip route` instead of `route`, which is not
 *   installed on Amazon Linux 2023, and rules saved with iptables-save.
 *
 * `set -e` makes a failed step stop the script visibly (EC2 console output)
 * instead of leaving a half-configured NAT.
 */
function natInstanceUserData(): ec2.UserData {
  const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash -xe' })
  userData.addCommands(
    'fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile',
    'dnf install -y --setopt=install_weak_deps=False iptables-services',
    'systemctl enable --now iptables',
    'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf',
    'sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf',
    'IFACE="$(ip route show default | awk \'{print $5; exit}\')"',
    'iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE',
    // The stock iptables-services rules REJECT all forwarding.
    'iptables -F FORWARD',
    // Persist across reboots. (`service iptables save` is not supported by
    // AL2023's service wrapper, so the default script never persisted them.)
    'iptables-save > /etc/sysconfig/iptables',
  )
  return userData
}

export interface OasiStackProps extends cdk.StackProps {
  stage: string
  config: StageConfig
  /** From AuthStack, deployed alongside. */
  userPool: cognito.IUserPool
  userPoolClient: cognito.IUserPoolClient
}

/**
 * One OASI environment: network, database, API, attachments, alarms.
 * The same code deploys `dev` and `prod`; what differs lives in config.ts
 * (cost knobs, allowed origins) and in `isProd` below (safety settings).
 */
export class OasiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OasiStackProps) {
    super(scope, id, props)

    const { stage, config, userPool, userPoolClient } = props
    const isProd = stage === 'prod'

    // ------------------------------------------------------------------
    // Network
    //
    // The database lives in isolated subnets (no route to the internet at
    // all). The Lambdas live in private subnets and reach the internet only
    // outbound, through NAT, for Secrets Manager, S3 and Cognito.
    // ------------------------------------------------------------------
    const natProvider =
      config.nat === 'instance'
        ? ec2.NatProvider.instanceV2({
            instanceType: new ec2.InstanceType('t4g.nano'),
            machineImage: ec2.MachineImage.latestAmazonLinux2023({
              cpuType: ec2.AmazonLinuxCpuType.ARM_64,
            }),
            associatePublicIpAddress: true,
            // Standard credits cap the bill: an idle NAT never needs bursts.
            creditSpecification: ec2.CpuCredits.STANDARD,
            // Nothing from the internet may open connections to it.
            defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
            userData: natInstanceUserData(),
          })
        : ec2.NatProvider.gateway()

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2, // RDS requires a subnet group spanning two AZs
      natGateways: 1, // one NAT, not one per AZ: no redundancy needed at this size
      natGatewayProvider: natProvider,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })

    if (natProvider instanceof ec2.NatInstanceProviderV2) {
      // Only machines inside this VPC may route through the NAT instance.
      natProvider.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic())

      // User data only runs on an instance's FIRST boot, and CloudFormation
      // updates user data in place without rebooting into it. Bump this id
      // whenever natInstanceUserData() changes, so the instance is replaced.
      for (const node of vpc.node.findAll()) {
        if (node instanceof ec2.CfnInstance) node.overrideLogicalId('VpcNatInstanceV2')
      }
    }

    // S3 traffic skips the NAT entirely. Gateway endpoints are free.
    vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 })

    // ------------------------------------------------------------------
    // Database
    // ------------------------------------------------------------------
    // CloudFormation restricts security group descriptions to a plain
    // character set - no em dashes or accents, or the deploy fails validation.
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'OASI Postgres: only reachable from the OASI Lambdas',
      allowAllOutbound: false,
    })

    const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: `oasi/${stage}/db`,
      description: `OASI ${stage} Postgres master credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'oasi_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true, // keeps the value safe in connection strings
        passwordLength: 32,
      },
    })

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      // Graviton t4g: same size as t3.micro, cheaper.
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: 'oasi',
      allocatedStorage: 20,
      maxAllocatedStorage: 100, // storage autoscaling, so it never fills up silently
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: false, // single AZ keeps cost down; automated backups cover recovery
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(isProd ? 14 : 1),
      deleteAutomatedBackups: !isProd,
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // ------------------------------------------------------------------
    // Attachments bucket
    // ------------------------------------------------------------------
    const attachmentsBucket = new s3.Bucket(this, 'Attachments', {
      bucketName: `oasi-${stage}-adjuntos-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      // The browser PUTs straight to S3 with a presigned URL, so S3 needs its
      // own CORS rule for the same origins the API accepts.
      cors: config.frontendOrigins.length
        ? [
            {
              allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
              allowedOrigins: config.frontendOrigins,
              allowedHeaders: ['*'],
              maxAge: 3000,
            },
          ]
        : undefined,
      lifecycleRules: [
        {
          // `ops/` only ever holds one-off data loads (scripts/load-data.sh),
          // which the db-ops Lambda deletes after use. This catches any that
          // were left behind by a failed load, so private data never lingers.
          prefix: 'ops/',
          expiration: cdk.Duration.days(1),
        },
      ],
    })

    // ------------------------------------------------------------------
    // Lambdas
    //
    // Both run the same bundle (dist-lambda/, built by `npm run build:lambda`):
    //   api     Express behind API Gateway — the app
    //   db-ops  migrations, first-time data load, first admin. Invoked by CI
    //           and by scripts/*.sh, never exposed over HTTP. It exists so the
    //           private database never needs a tunnel, bastion or public IP.
    // ------------------------------------------------------------------
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc,
      description: 'OASI Lambdas',
      allowAllOutbound: true,
    })

    dbSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(5432), 'OASI Lambdas to Postgres')

    const code = lambda.Code.fromAsset('../dist-lambda')

    const sharedEnvironment = {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--enable-source-maps',
      DB_HOST: database.dbInstanceEndpointAddress,
      DB_PORT: database.dbInstanceEndpointPort,
      DB_NAME: 'oasi',
      DB_USER: 'oasi_admin',
      DB_SECRET_ARN: dbCredentials.secretArn,
      S3_BUCKET_ADJUNTOS: attachmentsBucket.bucketName,
    }

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      code,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
    }

    // Explicit log groups rather than the Function's deprecated
    // `logRetention` prop, which provisions an extra custom-resource Lambda.
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/oasi-${stage}-${name}`,
        retention: isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      })

    const api = new lambda.Function(this, 'ApiFunction', {
      ...lambdaDefaults,
      functionName: `oasi-${stage}-api`,
      handler: 'handler.handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      logGroup: logGroup('api'),
      environment: {
        ...sharedEnvironment,
        AUTH_MODE: 'cognito', // never 'dev' in a deployed environment
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_REGION: this.region,
        CORS_ORIGIN: config.frontendOrigins.join(','),
      },
    })

    dbCredentials.grantRead(api)
    attachmentsBucket.grantReadWrite(api)

    // Lets an 'admin' user create/edit/remove people from the app itself
    // (routes/usuarios.ts). Scoped to this pool and these actions only.
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminDeleteUser',
        ],
        resources: [userPool.userPoolArn],
      }),
    )

    const dbOps = new lambda.Function(this, 'DbOpsFunction', {
      ...lambdaDefaults,
      functionName: `oasi-${stage}-db-ops`,
      handler: 'src/ops/dbOps.handler',
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logGroup: logGroup('db-ops'),
      environment: sharedEnvironment,
    })

    dbCredentials.grantRead(dbOps)
    attachmentsBucket.grantRead(dbOps, 'ops/*')
    attachmentsBucket.grantDelete(dbOps, 'ops/*')

    // ------------------------------------------------------------------
    // API Gateway
    //
    // CORS is answered by Express (app.ts), not here: with a proxy
    // integration every request, preflight included, reaches the Lambda, and
    // keeping the allowed-origins list in one place avoids the two drifting.
    // ------------------------------------------------------------------
    const restApi = new apigateway.LambdaRestApi(this, 'Api', {
      restApiName: `oasi-${stage}`,
      handler: api,
      proxy: true,
      // Execution logging needs an account-wide API Gateway role that both
      // environments would fight over; Lambda logs already carry the errors.
      cloudWatchRole: false,
      deployOptions: {
        stageName: stage,
        throttlingRateLimit: 50, // protects the t4g.micro behind it
        throttlingBurstLimit: 100,
        metricsEnabled: true,
      },
    })

    // ------------------------------------------------------------------
    // Alarms -> email. The subscription has to be confirmed once from the
    // inbox (AWS sends a "Subscription Confirmation" mail after deploy).
    // ------------------------------------------------------------------
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', { topicName: `oasi-${stage}-alarms` })
    alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail))
    const notify = new cwActions.SnsAction(alarmTopic)

    const alarm = (idSuffix: string, props: cloudwatch.AlarmProps) =>
      new cloudwatch.Alarm(this, idSuffix, props).addAlarmAction(notify)

    alarm('ApiErrorsAlarm', {
      alarmName: `oasi-${stage}-api-errors`,
      alarmDescription: 'The API Lambda threw errors (unhandled exceptions, timeouts).',
      metric: api.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    alarm('Api5xxAlarm', {
      alarmName: `oasi-${stage}-api-5xx`,
      alarmDescription: 'API Gateway returned 5xx responses.',
      metric: restApi.metricServerError({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    alarm('DbStorageAlarm', {
      alarmName: `oasi-${stage}-db-storage-low`,
      alarmDescription: 'Less than 2 GB free on the database.',
      metric: database.metricFreeStorageSpace({ period: cdk.Duration.minutes(15) }),
      threshold: 2 * 1024 ** 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
    })

    // ------------------------------------------------------------------
    // Outputs — read by CI and by scripts/*.sh
    // ------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: restApi.url,
      description: 'VITE_API_URL for the frontend (drop the trailing slash)',
    })
    new cdk.CfnOutput(this, 'DbOpsFunctionName', { value: dbOps.functionName })
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: database.dbInstanceEndpointAddress,
      description: 'Postgres host (reachable only from inside the VPC)',
    })
    new cdk.CfnOutput(this, 'DbSecretArn', { value: dbCredentials.secretArn })
    new cdk.CfnOutput(this, 'AttachmentsBucket', { value: attachmentsBucket.bucketName })
  }
}
