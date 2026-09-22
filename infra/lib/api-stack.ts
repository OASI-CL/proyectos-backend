import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import type { EnvConfig } from '../config'
import type { DatabaseTarget } from './database-stack'

export interface ApiStackProps extends cdk.StackProps {
  config: EnvConfig
  vpc: ec2.IVpc
  /** Subnets con salida a internet por el NAT. */
  lambdaSubnets: ec2.SubnetSelection
  lambdaSecurityGroup: ec2.ISecurityGroup
  /** undefined cuando database.mode === 'local' (no hay base en AWS). */
  database?: DatabaseTarget
  bucket: s3.IBucket
  cognito: { userPoolId: string; userPoolClientId: string }
}

/**
 * ============================================================================
 * API — la Lambda con el backend, más la Lambda de operaciones de base
 * ============================================================================
 *
 * Dos funciones por ambiente:
 *
 *   oasi-api-<env>      la app (Express corriendo tal cual, vía
 *                       serverless-http) detrás de un HTTP API de API Gateway.
 *   oasi-db-ops-<env>   migraciones, carga inicial de datos y el primer
 *                       admin. No tiene URL: solo se la puede invocar con
 *                       credenciales de AWS. Existe porque la base es privada
 *                       y no se puede llegar a ella desde un PC.
 *
 * Las dos viven DENTRO de la VPC, porque la base no tiene salida a internet.
 * Por eso la red necesita el NAT (ver network-stack.ts).
 *
 * HTTP API en vez de REST API: hace lo mismo para este caso y cuesta ~1/3.
 *
 * Aislamiento: cada Lambda recibe permiso IAM sobre el secreto de SU ambiente
 * únicamente. La de dev no puede leer la credencial de prod.
 * ============================================================================
 */
export class ApiStack extends cdk.Stack {
  readonly apiUrl: string

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props)

    const { config, vpc, lambdaSubnets, lambdaSecurityGroup, database, bucket, cognito } = props
    const env = config.envName
    const isProd = env === 'prod'

    const code = lambda.Code.fromAsset('../dist-lambda')

    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/oasi-${name}-${env}`,
        retention: isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
        removalPolicy:
          config.removalPolicy === 'retain' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      })

    // Datos de conexión. La contraseña NO va acá: la Lambda la lee de Secrets
    // Manager en cada arranque en frío (ver src/db/client.ts).
    const databaseEnvironment: Record<string, string> = database
      ? {
          DB_HOST: database.host,
          DB_PORT: database.port,
          DB_NAME: database.databaseName,
          DB_USER: config.database.databaseUser,
          DB_SECRET_ARN: database.userSecret.secretArn,
        }
      : {}

    const common = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64, // ~20% más barato que x86
      code,
      vpc,
      vpcSubnets: lambdaSubnets,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--enable-source-maps',
        ...databaseEnvironment,
      },
    }

    // ------------------------------------------------------------------
    // La API
    // ------------------------------------------------------------------
    const api = new lambda.Function(this, 'ApiFunction', {
      ...common,
      functionName: `oasi-api-${env}`,
      handler: 'handler.handler',
      memorySize: config.lambda.memoryMb,
      timeout: cdk.Duration.seconds(config.lambda.timeoutSeconds),
      logGroup: logGroup('api'),
      environment: {
        ...common.environment,
        // Nunca 'dev' en un ambiente desplegado: en modo dev cualquiera
        // elegiría su propio rol con un header HTTP.
        AUTH_MODE: 'cognito',
        // El stage del HTTP API va en la ruta que recibe la Lambda; handler.ts
        // lo necesita para quitarlo antes de pasársela a Express.
        API_STAGE: env,
        COGNITO_USER_POOL_ID: cognito.userPoolId,
        COGNITO_CLIENT_ID: cognito.userPoolClientId,
        COGNITO_REGION: this.region,
        S3_BUCKET_ADJUNTOS: bucket.bucketName,
        CORS_ORIGIN: config.frontendOrigins.join(','),
      },
    })

    database?.userSecret.grantRead(api)
    bucket.grantReadWrite(api)

    // Permite que un usuario 'admin' cree y borre cuentas desde la propia app
    // (routes/usuarios.ts), en lugar de tener que usar la consola de AWS.
    // Acotado a este User Pool y solo a estas cuatro acciones.
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminDeleteUser',
        ],
        resources: [
          `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${cognito.userPoolId}`,
        ],
      }),
    )

    // ------------------------------------------------------------------
    // HTTP API. El CORS lo responde Express (src/app.ts), no API Gateway:
    // con integración proxy todo request llega a la Lambda, y así la lista de
    // orígenes permitidos vive en un solo lugar.
    // ------------------------------------------------------------------
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: `oasi-${env}`,
      defaultIntegration: new integrations.HttpLambdaIntegration('ApiIntegration', api),
      // Sin stage automático: queremos uno que se llame como el ambiente, así
      // la URL termina en /dev o /prod.
      createDefaultStage: false,
    })

    const stage = new apigw.HttpStage(this, 'Stage', {
      httpApi,
      stageName: env,
      autoDeploy: true,
      throttle: {
        // Protege a la base t4g.micro que está detrás.
        rateLimit: 50,
        burstLimit: 100,
      },
    })

    this.apiUrl = stage.url

    // ------------------------------------------------------------------
    // Operaciones de base de datos (migraciones, carga inicial, primer admin)
    // ------------------------------------------------------------------
    if (database) {
      const dbOps = new lambda.Function(this, 'DbOpsFunction', {
        ...common,
        functionName: `oasi-db-ops-${env}`,
        handler: 'src/ops/dbOps.handler',
        memorySize: 512,
        timeout: cdk.Duration.minutes(5),
        logGroup: logGroup('db-ops'),
        environment: {
          ...common.environment,
          // La carga inicial de datos lee el dump desde el bucket (prefijo
          // ops/) y lo borra al terminar.
          S3_BUCKET_ADJUNTOS: bucket.bucketName,
          // Bases de los OTROS ambientes en el mismo servidor. La acción
          // check-isolation intenta abrirlas con las credenciales de este
          // ambiente y espera que falle.
          OTHER_DATABASES: database.otherDatabases.join(','),
        },
      })

      database.userSecret.grantRead(dbOps)
      bucket.grantRead(dbOps, 'ops/*')
      bucket.grantDelete(dbOps, 'ops/*')

      new cdk.CfnOutput(this, 'DbOpsFunctionName', { value: dbOps.functionName })
    }

    // ------------------------------------------------------------------
    // Alarmas por correo. La suscripción hay que confirmarla una vez desde el
    // mail que manda AWS ("Subscription Confirmation"), o no llega nada.
    // ------------------------------------------------------------------
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', { topicName: `oasi-${env}-alarms` })
    alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail))
    const notify = new cwActions.SnsAction(alarmTopic)

    const alarm = (alarmId: string, alarmProps: cloudwatch.AlarmProps) =>
      new cloudwatch.Alarm(this, alarmId, alarmProps).addAlarmAction(notify)

    alarm('ApiErrorsAlarm', {
      alarmName: `oasi-${env}-api-errors`,
      alarmDescription: 'La Lambda de la API tiro errores (excepciones o timeouts).',
      metric: api.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    alarm('ApiLatencyAlarm', {
      alarmName: `oasi-${env}-api-slow`,
      alarmDescription: 'La API esta respondiendo lento (p95 sobre 5 segundos).',
      metric: api.metricDuration({ period: cdk.Duration.minutes(15), statistic: 'p95' }),
      threshold: 5000,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      description: 'VITE_API_URL del frontend (sin la barra final)',
    })
  }
}
