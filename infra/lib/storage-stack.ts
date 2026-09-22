import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { EnvConfig } from '../config'

export interface StorageStackProps extends cdk.StackProps {
  config: EnvConfig
}

/**
 * ============================================================================
 * S3 — los archivos adjuntos de cada permiso
 * ============================================================================
 *
 * Un bucket por ambiente, privado. El navegador sube y baja directo a S3 con
 * URLs prefirmadas que genera la API, así los archivos nunca pasan por la
 * Lambda (que tiene límite de tamaño y se cobra por tiempo de ejecución).
 *
 * El nombre lleva el número de cuenta porque los nombres de bucket son únicos
 * en TODO AWS, no solo en tu cuenta.
 * ============================================================================
 */
export class StorageStack extends cdk.Stack {
  readonly bucket: s3.Bucket

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props)

    const { config } = props
    const isProd = config.envName === 'prod'

    this.bucket = new s3.Bucket(this, 'Attachments', {
      bucketName: `oasi-adjuntos-${config.envName}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // Versionado en prod: si alguien reemplaza un archivo por error, la
      // versión anterior sigue estando.
      versioned: isProd,
      removalPolicy:
        config.removalPolicy === 'retain' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.removalPolicy === 'destroy',
      // El navegador sube directo a S3, así que S3 necesita su propia lista
      // de orígenes permitidos, igual que la API.
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
          // `ops/` solo se usa para la carga inicial de datos históricos, que
          // la Lambda borra en cuanto termina. Esta regla limpia cualquier
          // archivo que haya quedado por una carga fallida, para que datos
          // privados no se queden ahí olvidados.
          prefix: 'ops/',
          expiration: cdk.Duration.days(1),
        },
      ],
    })

    new cdk.CfnOutput(this, 'BucketName', { value: this.bucket.bucketName })
  }
}
