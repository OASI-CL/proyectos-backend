import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import type { EnvConfig } from '../config'
import { correoInvitacion, correoRecuperacion } from './correos'

export interface AuthStackProps extends cdk.StackProps {
  config: EnvConfig
}

/**
 * ============================================================================
 * COGNITO — quién puede entrar a la app, por ambiente
 * ============================================================================
 *
 * Un User Pool por ambiente, con cuentas separadas: quien tiene cuenta en dev
 * no la tiene en prod. Es deliberado, porque en prod van a entrar seremis y
 * subsecretarios.
 *
 * OJO: el pool de dev ya existía antes de esta infraestructura, con usuarios
 * reales adentro, así que se reusa en vez de crearlo (ver `cognito` en
 * config.ts). Este stack solo se despliega para los ambientes que NO traen
 * ids en config.ts. Recrear un pool significa que todos pierden la cuenta y
 * hay que volver a invitarlos.
 *
 * Cognito es gratis hasta 10.000 usuarios activos por mes.
 * ============================================================================
 */
export class AuthStack extends cdk.Stack {
  readonly userPool: cognito.UserPool
  readonly userPoolClient: cognito.UserPoolClient

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    const { config } = props
    const isProd = config.envName === 'prod'
    const invitacion = correoInvitacion(config.appUrl)
    const recuperacion = correoRecuperacion(config.appUrl)

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `oasi-users-${config.envName}`,
      // Sistema interno: las cuentas las crea un administrador desde la app,
      // nadie se registra solo.
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
      // El correo lo manda Cognito. Tope: 50 mails por día, suficiente para
      // invitaciones y recuperación de contraseña de un equipo chico. Para
      // una carga grande de usuarios hay que pasar a SES.
      email: cognito.UserPoolEmail.withCognito(),
      // Los dos correos que manda Cognito (invitación con contraseña temporal
      // y código de recuperación). Diseño en lib/correos.ts, que también usa
      // scripts/correos-cognito.ts para el pool de dev.
      userInvitation: {
        emailSubject: invitacion.asunto,
        emailBody: invitacion.html,
      },
      userVerification: {
        emailSubject: recuperacion.asunto,
        emailBody: recuperacion.html,
      },
      // Borrar el pool borra todas las cuentas: en prod que sea una decisión
      // de dos pasos, no un efecto secundario.
      deletionProtection: isProd,
      removalPolicy:
        config.removalPolicy === 'retain' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // Un grupo por rol de la app. El backend igual considera autoritaria la
    // tabla `usuarios`, porque ahí vive el alcance (qué empresa, qué
    // organismo, qué región) y un rol sin su alcance no se puede aplicar.
    for (const rol of ['admin', 'oasi', 'organismo', 'empresa', 'region']) {
      new cognito.CfnUserPoolGroup(this, `Group-${rol}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: rol,
        description: `Rol OASI: ${rol}`,
      })
    }

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `oasi-${config.envName}-web`,
      // SRP: la contraseña nunca viaja, el navegador prueba que la conoce.
      authFlows: { userSrp: true },
      // Aplicación web: sin client secret, un navegador no puede guardarlo.
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    })

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'VITE_COGNITO_USER_POOL_ID',
    })
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
    })
  }
}
