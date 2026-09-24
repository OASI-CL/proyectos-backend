import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import type { EnvConfig } from '../config'

export interface AuthStackProps extends cdk.StackProps {
  config: EnvConfig
}

/**
 * El logo se sirve desde el frontend de Amplify: es la única URL pública que
 * ya tenemos (Cognito no aloja archivos, el correo necesita una URL https).
 * Sirve de ambos ambientes porque Amplify comparte el mismo dominio para las
 * dos ramas (main / develop) de una app, y el archivo es idéntico en las dos.
 */
const LOGO_URL = 'https://main.dyfx5stqf038v.amplifyapp.com/logo-ministerio.png'

/**
 * Envoltorio HTML compartido por los dos correos de Cognito (invitación y
 * recuperación de contraseña). Estilos en línea a propósito: los clientes de
 * correo (Gmail, Outlook) ignoran o recortan una hoja de estilos separada.
 */
function plantillaCorreo(tituloInterno: string, cuerpoHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#EEF2F8;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F8;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#006BB9;padding:22px 28px;">
              <table role="presentation" width="100%"><tr>
                <td style="vertical-align:middle;">
                  <img src="${LOGO_URL}" alt="Gobierno de Chile" height="40" style="display:block;border:0;" />
                </td>
                <td style="vertical-align:middle;text-align:right;">
                  <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">OASI</span>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;color:#25306B;font-size:16px;line-height:1.55;">
              ${cuerpoHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:#F5F7FB;color:#6B7280;font-size:12.5px;text-align:center;">
              Gobierno de Chile — Catastro de seguimiento de permisos sectoriales (OASI)
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

const CAJA_CODIGO = (valor: string) =>
  `<div style="margin:20px 0;padding:16px 20px;background:#EAF3FC;border:1.5px dashed #006BB9;` +
  `border-radius:8px;text-align:center;font-size:24px;font-weight:700;letter-spacing:1px;color:#25306B;">` +
  `${valor}</div>`

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
      // Los dos correos que Cognito manda solo: la invitación (cuenta creada
      // por un admin, con contraseña temporal) y el código de recuperación
      // de contraseña. Cognito acepta HTML en el cuerpo cuando el envío es
      // por correo (no por SMS) — los placeholders {username} / {####} los
      // reemplaza él antes de mandar.
      userInvitation: {
        emailSubject: 'Tu cuenta de OASI está lista',
        emailBody: plantillaCorreo(
          'Invitación',
          `<p style="margin:0 0 4px;font-size:18px;font-weight:600;">¡Bienvenido/a a OASI!</p>
           <p style="margin:0 0 16px;color:#6B7280;">Catastro de seguimiento de permisos sectoriales</p>
           <p style="margin:0 0 4px;">Ya te crearon una cuenta con el correo:</p>
           <p style="margin:0 0 16px;font-weight:600;">{username}</p>
           <p style="margin:0 0 4px;">Tu contraseña temporal es:</p>
           ${CAJA_CODIGO('{####}')}
           <p style="margin:16px 0 0;color:#6B7280;font-size:14px;">
             Al entrar por primera vez te va a pedir que la cambies por una tuya.
             Esta contraseña es válida por 7 días.
           </p>`,
        ),
      },
      userVerification: {
        emailSubject: 'Código para recuperar tu contraseña de OASI',
        emailBody: plantillaCorreo(
          'Recuperación',
          `<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Recuperar contraseña</p>
           <p style="margin:0 0 4px;">Pediste cambiar tu contraseña de OASI. Usá este código:</p>
           ${CAJA_CODIGO('{####}')}
           <p style="margin:16px 0 0;color:#6B7280;font-size:14px;">
             Si no fuiste vos, podés ignorar este correo: tu contraseña actual sigue funcionando.
           </p>`,
        ),
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
