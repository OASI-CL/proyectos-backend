import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { CONFIG, SHARED, type EnvName } from '../config'

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc
  /** Subnets sin salida a internet, donde vive la base. */
  databaseSubnets: ec2.SubnetSelection
  /** Subnets con salida por el NAT, donde corre la Lambda de bootstrap. */
  lambdaSubnets: ec2.SubnetSelection
  databaseSecurityGroup: ec2.ISecurityGroup
  lambdaSecurityGroup: ec2.ISecurityGroup
}

/** Lo que cada ambiente necesita saber para conectarse a su base. */
export interface DatabaseTarget {
  host: string
  port: string
  databaseName: string
  /** Secreto con el usuario y la contraseña de ESE ambiente, y de ningún otro. */
  userSecret: secretsmanager.ISecret
  /** Bases de otros ambientes en el mismo servidor (para check-isolation). */
  otherDatabases: string[]
}

/**
 * ============================================================================
 * BASE DE DATOS — un servidor RDS, dos bases aisladas adentro
 * ============================================================================
 *
 * Por qué un solo servidor: un RDS encendido cuesta ~US$14/mes sin importar
 * cuánto se use. Dos servidores serían ~US$28 para atender 20 usuarios y una
 * base de pocos MB. Con uno solo, dev sale gratis.
 *
 * Cómo quedan aislados, en tres capas independientes:
 *
 *   1. Postgres      cada ambiente tiene su propia base (oasi_dev, oasi_prod)
 *                    y su propio usuario, dueño de esa base. A cada usuario se
 *                    le QUITA explícitamente el permiso de conectarse a la base
 *                    del otro, y se le quita el permiso a PUBLIC (que en
 *                    Postgres, por defecto, deja entrar a cualquier rol).
 *   2. Secrets       dos secretos separados, uno por ambiente.
 *   3. IAM           la Lambda de dev solo tiene permiso de leer el secreto de
 *                    dev. Ni siquiera puede ver el de prod.
 *
 * O sea: aunque alguien copie mal un connection string, o se filtre la
 * credencial de dev, no se llega a los datos de prod.
 *
 * PARA DARLE A UN AMBIENTE SU PROPIO SERVIDOR (cuando el presupuesto alcance):
 * en config.ts, cambiar su `database.mode` de 'shared' a 'dedicated'. Este
 * stack crea la instancia nueva y el ambiente pasa a usarla. Es una línea.
 * ============================================================================
 */
export class DatabaseStack extends cdk.Stack {
  /** Por ambiente, a dónde conectarse. Lo consume api-stack. */
  readonly targets: Partial<Record<EnvName, DatabaseTarget>>
  /** Lambda que crea bases y usuarios. Solo la invoca un admin (ver README). */
  readonly bootstrapFunction: lambda.Function

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props)

    const { vpc, databaseSubnets, lambdaSubnets, databaseSecurityGroup, lambdaSecurityGroup } = props
    this.targets = {}

    // ------------------------------------------------------------------
    // Un secreto por ambiente: usuario fijo (de config.ts) y contraseña
    // generada por CDK, que nunca pasa por el código ni por git.
    // ------------------------------------------------------------------
    const userSecrets = {} as Record<EnvName, secretsmanager.Secret>

    for (const env of Object.keys(CONFIG) as EnvName[]) {
      const cfg = CONFIG[env]
      if (cfg.database.mode === 'local') continue

      userSecrets[env] = new secretsmanager.Secret(this, `UserSecret-${env}`, {
        secretName: `oasi/db/${env}`,
        description: `OASI ${env}: usuario de Postgres de este ambiente`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: cfg.database.databaseUser,
            dbname: cfg.database.databaseName,
          }),
          generateStringKey: 'password',
          // Sin signos de puntuación: así la contraseña es segura de pegar en
          // un connection string sin escapar nada.
          excludePunctuation: true,
          passwordLength: 32,
        },
        removalPolicy:
          cfg.removalPolicy === 'retain' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      })
    }

    // ------------------------------------------------------------------
    // Instancias RDS: la compartida y, si algún ambiente lo pide, dedicadas.
    // ------------------------------------------------------------------
    const sharedEnvs = (Object.keys(CONFIG) as EnvName[]).filter(
      (env) => CONFIG[env].database.mode === 'shared',
    )

    let sharedInstance: rds.DatabaseInstance | undefined
    if (sharedEnvs.length > 0) {
      sharedInstance = this.createInstance('Shared', 'oasi-shared', {
        instanceClass: SHARED.database.instanceClass,
        allocatedStorageGb: SHARED.database.allocatedStorageGb,
        multiAz: SHARED.database.multiAz,
        backupRetentionDays: SHARED.database.backupRetentionDays,
        vpc,
        subnets: databaseSubnets,
        securityGroup: databaseSecurityGroup,
      })

      for (const env of sharedEnvs) {
        this.targets[env] = {
          host: sharedInstance.dbInstanceEndpointAddress,
          port: sharedInstance.dbInstanceEndpointPort,
          databaseName: CONFIG[env].database.databaseName,
          userSecret: userSecrets[env],
          // Las de los demás ambientes que comparten este servidor.
          otherDatabases: sharedEnvs
            .filter((other) => other !== env)
            .map((other) => CONFIG[other].database.databaseName),
        }
      }
    }

    const dedicatedInstances: Partial<Record<EnvName, rds.DatabaseInstance>> = {}
    for (const env of Object.keys(CONFIG) as EnvName[]) {
      const cfg = CONFIG[env]
      if (cfg.database.mode !== 'dedicated') continue

      const instance = this.createInstance(`Dedicated-${env}`, `oasi-${env}`, {
        instanceClass: cfg.database.instanceClass ?? SHARED.database.instanceClass,
        allocatedStorageGb: cfg.database.allocatedStorageGb ?? SHARED.database.allocatedStorageGb,
        multiAz: cfg.database.multiAz ?? SHARED.database.multiAz,
        backupRetentionDays:
          cfg.database.backupRetentionDays ?? SHARED.database.backupRetentionDays,
        vpc,
        subnets: databaseSubnets,
        securityGroup: databaseSecurityGroup,
      })
      dedicatedInstances[env] = instance

      this.targets[env] = {
        host: instance.dbInstanceEndpointAddress,
        port: instance.dbInstanceEndpointPort,
        databaseName: cfg.database.databaseName,
        userSecret: userSecrets[env],
        // Servidor dedicado: no hay otras bases de las que aislarse.
        otherDatabases: [],
      }
    }

    // ------------------------------------------------------------------
    // Lambda de bootstrap: crea las bases, los usuarios y los permisos.
    //
    // Es la ÚNICA pieza que tiene la credencial maestra, y por eso está
    // separada de las Lambdas de cada ambiente: la de dev nunca puede
    // tocar prod. Se invoca a mano (npm run db:bootstrap) una vez por
    // servidor nuevo; es idempotente, correrla de nuevo no rompe nada.
    // ------------------------------------------------------------------
    const instancesByEnv: Partial<Record<EnvName, rds.DatabaseInstance>> = {}
    for (const env of sharedEnvs) instancesByEnv[env] = sharedInstance
    Object.assign(instancesByEnv, dedicatedInstances)

    // Para cada base: en qué servidor vive, con qué credencial maestra se
    // crea, qué usuario la administra y a qué otras bases del MISMO servidor
    // hay que negarle el acceso a ese usuario.
    const bootstrapTargets = (Object.keys(instancesByEnv) as EnvName[]).map((env) => {
      const instance = instancesByEnv[env]!
      const otherDatabases = (Object.keys(instancesByEnv) as EnvName[])
        .filter((other) => other !== env && instancesByEnv[other] === instance)
        .map((other) => CONFIG[other].database.databaseName)

      return {
        env,
        host: instance.dbInstanceEndpointAddress,
        port: instance.dbInstanceEndpointPort,
        masterSecretArn: instance.secret!.secretArn,
        userSecretArn: userSecrets[env].secretArn,
        databaseName: CONFIG[env].database.databaseName,
        databaseUser: CONFIG[env].database.databaseUser,
        otherDatabases,
      }
    })

    this.bootstrapFunction = new lambda.Function(this, 'BootstrapFunction', {
      functionName: 'oasi-db-bootstrap',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'src/ops/dbBootstrap.handler',
      code: lambda.Code.fromAsset('../dist-lambda'),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      vpc,
      vpcSubnets: lambdaSubnets,
      securityGroups: [lambdaSecurityGroup],
      environment: {
        NODE_ENV: 'production',
        BOOTSTRAP_TARGETS: JSON.stringify(bootstrapTargets),
      },
      logGroup: new logs.LogGroup(this, 'BootstrapLogGroup', {
        logGroupName: '/aws/lambda/oasi-db-bootstrap',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    for (const instance of new Set(Object.values(instancesByEnv))) {
      instance!.secret!.grantRead(this.bootstrapFunction)
    }
    for (const secret of Object.values(userSecrets)) {
      secret.grantRead(this.bootstrapFunction)
    }

    // ------------------------------------------------------------------
    // Salidas
    // ------------------------------------------------------------------
    if (sharedInstance) {
      new cdk.CfnOutput(this, 'SharedDbEndpoint', {
        value: sharedInstance.dbInstanceEndpointAddress,
        description: 'Host del servidor compartido (solo alcanzable dentro de la VPC)',
      })
    }
    new cdk.CfnOutput(this, 'BootstrapFunctionName', { value: this.bootstrapFunction.functionName })
  }

  /**
   * Una instancia RDS con los ajustes de mínimo costo que pide el proyecto.
   * Todo lo configurable sale de config.ts.
   */
  private createInstance(
    id: string,
    identifier: string,
    opts: {
      instanceClass: string
      allocatedStorageGb: number
      multiAz: boolean
      backupRetentionDays: number
      vpc: ec2.IVpc
      subnets: ec2.SubnetSelection
      securityGroup: ec2.ISecurityGroup
    },
  ): rds.DatabaseInstance {
    const publiclyAccessible = SHARED.database.publiclyAccessible

    return new rds.DatabaseInstance(this, id, {
      instanceIdentifier: identifier,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of(
          SHARED.database.engineVersion,
          SHARED.database.engineVersion.split('.')[0],
        ),
      }),
      instanceType: new ec2.InstanceType(opts.instanceClass.replace(/^db\./, '')),
      vpc: opts.vpc,
      // Privada: subnets sin ninguna ruta a internet. Si en config.ts se
      // activa publiclyAccessible, pasa a subnets públicas.
      vpcSubnets: publiclyAccessible ? { subnetType: ec2.SubnetType.PUBLIC } : opts.subnets,
      publiclyAccessible,
      securityGroups: [opts.securityGroup],
      // La contraseña maestra la genera CDK y vive solo en Secrets Manager.
      credentials: rds.Credentials.fromGeneratedSecret('oasi_admin', {
        secretName: `oasi/db/master-${identifier}`,
        // Sin caracteres que compliquen pegar la contraseña en una URL de
        // conexión o en una línea de comandos.
        excludeCharacters: "/@\"' \\",
      }),
      allocatedStorage: opts.allocatedStorageGb,
      // Autoescalado de disco DESACTIVADO: que nunca crezca solo.
      maxAllocatedStorage: SHARED.database.maxAllocatedStorageGb,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: opts.multiAz,
      backupRetention: cdk.Duration.days(opts.backupRetentionDays),
      // Performance Insights desactivado: la versión con retención larga cuesta.
      enablePerformanceInsights: false,
      autoMinorVersionUpgrade: true,
      // El servidor compartido guarda los datos de prod, así que se protege
      // como prod aunque dev también lo use. Para borrarlo hay que apagar
      // esta protección primero (ver infra/README.md).
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
  }
}
