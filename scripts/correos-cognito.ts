/**
 * Actualiza los correos de Cognito (invitación y recuperación de contraseña)
 * de un ambiente con las plantillas de infra/lib/correos.ts.
 *
 *   AWS_PROFILE=oasi npx tsx scripts/correos-cognito.ts --env=dev
 *
 * Por qué existe: el pool de PROD lo maneja CDK (infra/lib/auth-stack.ts),
 * así que en prod los correos se actualizan con `cdk deploy Oasi-Auth-prod`.
 * El pool de DEV es uno viejo que se reusa (config.ts, existingUserPoolId) y
 * CDK no lo toca: este script lo actualiza por la API.
 *
 * OJO: UpdateUserPool deja en su valor POR DEFECTO todo lo que no se le
 * pasa (política de contraseñas, MFA, recuperación, ...). Por eso primero se
 * lee la configuración completa del pool y se reenvía entera, cambiando solo
 * las plantillas de correo.
 */
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { SHARED, envConfig } from '../infra/config'
import { correoInvitacion, correoRecuperacion } from '../infra/lib/correos'

async function main() {
  const env = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1]
  if (!env) {
    console.error('Uso: npx tsx scripts/correos-cognito.ts --env=dev')
    process.exit(2)
  }
  const config = envConfig(env)
  const poolId = config.cognito.existingUserPoolId
  if (!poolId) {
    console.log(`El pool de ${env} lo maneja CDK: los correos se actualizan con`)
    console.log(`  cd infra && npx cdk deploy Oasi-Auth-${env}`)
    return
  }

  const invitacion = correoInvitacion(config.appUrl)
  const recuperacion = correoRecuperacion(config.appUrl)
  const client = new CognitoIdentityProviderClient({ region: SHARED.region })

  const { UserPool: p } = await client.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))
  if (!p) throw new Error(`No encontré el pool ${poolId}`)

  await client.send(
    new UpdateUserPoolCommand({
      UserPoolId: poolId,
      // --- lo que ya tenía, reenviado tal cual ---
      Policies: p.Policies,
      DeletionProtection: p.DeletionProtection,
      LambdaConfig: p.LambdaConfig,
      AutoVerifiedAttributes: p.AutoVerifiedAttributes,
      SmsAuthenticationMessage: p.SmsAuthenticationMessage,
      UserAttributeUpdateSettings: p.UserAttributeUpdateSettings,
      MfaConfiguration: p.MfaConfiguration,
      DeviceConfiguration: p.DeviceConfiguration,
      EmailConfiguration: p.EmailConfiguration,
      SmsConfiguration: p.SmsConfiguration,
      UserPoolTags: p.UserPoolTags,
      UserPoolAddOns: p.UserPoolAddOns,
      AccountRecoverySetting: p.AccountRecoverySetting,
      // --- lo que cambia: las plantillas ---
      AdminCreateUserConfig: {
        ...p.AdminCreateUserConfig,
        InviteMessageTemplate: {
          ...p.AdminCreateUserConfig?.InviteMessageTemplate,
          EmailSubject: invitacion.asunto,
          EmailMessage: invitacion.html,
        },
      },
      EmailVerificationSubject: recuperacion.asunto,
      EmailVerificationMessage: recuperacion.html,
      VerificationMessageTemplate: {
        ...p.VerificationMessageTemplate,
        DefaultEmailOption: 'CONFIRM_WITH_CODE',
        EmailSubject: recuperacion.asunto,
        EmailMessage: recuperacion.html,
      },
    }),
  )
  console.log(`Correos de Cognito actualizados en ${env} (${poolId}). Botón -> ${config.appUrl}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
