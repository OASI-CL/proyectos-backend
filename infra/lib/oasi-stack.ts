import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'

export interface OasiStackProps extends cdk.StackProps {
  /** e.g. 'dev' | 'prod'. Used to name resources and pick safety settings. */
  stage: string
  /**
   * Origin allowed to call the API — the Amplify URL of the frontend.
   * Leave undefined on first deploy (Amplify does not exist yet), then set it
   * and redeploy. Never leave it open in production.
   */
  frontendOrigin?: string
}

/**
 * The whole OASI backend in one stack: network, database, auth, API.
 *
 * Deliberately kept to a single stack — this is a ~20-user internal system,
 * and splitting it would add cross-stack plumbing for no benefit. Everything
 * the app needs to run is here, and `cdk destroy` cleans it all up.
 */
export class OasiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OasiStackProps) {
    super(scope, id, props)

    const { stage } = props
    const isProd = stage === 'prod'

    // ------------------------------------------------------------------
    // Network
    //
    // One NAT gateway instead of one per AZ: it is the single most expensive
    // line item in a small stack (~$32/month each) and a 20-user internal
    // tool does not need NAT redundancy.
    // ------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2, // RDS requires at least two AZs for its subnet group
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })

    // ------------------------------------------------------------------
    // Database
    //
    // t3.micro / Postgres, in isolated subnets: the database is never
    // reachable from the internet, only from the Lambda security group.
    // ------------------------------------------------------------------
    // NOTE: CloudFormation restricts security group descriptions to a plain
    // character set - no em dashes or accents, or the deploy fails validation.
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'OASI Postgres: only reachable from the API Lambda',
      allowAllOutbound: false,
    })

    const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: `oasi/${stage}/db`,
      description: 'OASI Postgres master credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'oasi_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true, // keeps the value safe in connection strings
        passwordLength: 32,
      },
    })

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: 'oasi',
      allocatedStorage: 20,
      maxAllocatedStorage: 100, // autoscaling storage, so it never fills up silently
      backupRetention: cdk.Duration.days(isProd ? 14 : 1),
      deleteAutomatedBackups: !isProd,
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      storageEncrypted: true,
      multiAz: false, // single AZ keeps the cost down; backups cover recovery
    })

    // ------------------------------------------------------------------
    // Auth — Cognito
    //
    // One group per app role. The backend reads the group from the JWT, but
    // the `usuarios` table is authoritative because that is where the scope
    // (which company / agency / region) lives.
    // ------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `oasi-${stage}`,
      // Internal system: accounts are created by an admin, never self-service.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    for (const rol of ['admin', 'oasi', 'organismo', 'empresa', 'region']) {
      new cognito.CfnUserPoolGroup(this, `Group-${rol}`, {
        userPoolId: userPool.userPoolId,
        groupName: rol,
        description: `OASI role: ${rol}`,
      })
    }

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: `oasi-${stage}-web`,
      authFlows: { userSrp: true },
      // SPA: no client secret, the browser cannot keep one.
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
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
      cors: [
        {
          // The browser PUTs straight to S3 with a presigned URL.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: props.frontendOrigin ? [props.frontendOrigin] : ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    })

    // ------------------------------------------------------------------
    // API Lambda
    // ------------------------------------------------------------------
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc,
      description: 'OASI API Lambda',
      allowAllOutbound: true,
    })

    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'API Lambda to Postgres',
    )

    // Explicit log group rather than the Function's `logRetention` prop: that
    // one is deprecated and provisions an extra custom-resource Lambda just to
    // set the retention.
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/oasi-${stage}-api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    const api = new lambda.Function(this, 'ApiFunction', {
      functionName: `oasi-${stage}-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      // `npm run build:lambda` produces this folder (see package.json).
      code: lambda.Code.fromAsset('../dist-lambda'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
      logGroup: apiLogGroup,
      environment: {
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito', // never 'dev' in a deployed environment
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_PORT: database.dbInstanceEndpointPort,
        DB_NAME: 'oasi',
        DB_USER: 'oasi_admin',
        DB_SECRET_ARN: dbCredentials.secretArn,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_REGION: this.region,
        S3_BUCKET_ADJUNTOS: attachmentsBucket.bucketName,
        CORS_ORIGIN: props.frontendOrigin ?? '',
      },
    })

    dbCredentials.grantRead(api)
    attachmentsBucket.grantReadWrite(api)

    // ------------------------------------------------------------------
    // API Gateway
    // ------------------------------------------------------------------
    const restApi = new apigateway.LambdaRestApi(this, 'Api', {
      restApiName: `oasi-${stage}`,
      handler: api,
      proxy: true, // Express does the routing
      deployOptions: {
        stageName: stage,
        // Small internal system, but throttling protects the t3.micro behind it.
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: props.frontendOrigin
          ? [props.frontendOrigin]
          : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    // ------------------------------------------------------------------
    // Outputs — these are what you paste into Amplify's env vars
    // ------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: restApi.url,
      description: 'VITE_API_URL for the frontend',
    })
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'VITE_COGNITO_USER_POOL_ID',
    })
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
    })
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: database.dbInstanceEndpointAddress,
      description: 'Postgres host (reachable only from inside the VPC)',
    })
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbCredentials.secretArn,
      description: 'Secrets Manager ARN holding the DB password',
    })
    new cdk.CfnOutput(this, 'AttachmentsBucket', {
      value: attachmentsBucket.bucketName,
    })
  }
}
