import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { RolUsuario } from '../shared/types'

/**
 * Creates and manages the Cognito side of a user, so "add a user" is one
 * action from the app instead of "run these AWS CLI commands" (see
 * infra/COGNITO_SETUP.md, which is how the very first admin still has to be
 * created — this service is what everyone after that goes through instead).
 *
 * Username = email. Cognito sends the invite email itself (temporary
 * password, forced change on first sign-in) — the frontend's Login screen
 * already handles that challenge, so nothing extra was needed there.
 */

let clientCache: CognitoIdentityProviderClient | null = null

function getClient(): CognitoIdentityProviderClient {
  if (!clientCache) {
    clientCache = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION })
  }
  return clientCache
}

export class CognitoUserError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function requirePoolId(): string {
  const poolId = process.env.COGNITO_USER_POOL_ID
  if (!poolId) {
    throw new CognitoUserError(
      503,
      'cognito_no_configurado',
      'Falta COGNITO_USER_POOL_ID en el backend. No se pueden crear usuarios todavía.',
    )
  }
  return poolId
}

/**
 * Creates the Cognito account and puts it in the group matching `rol`.
 * Returns the `sub` — the id the `usuarios` table keys off.
 */
export async function crearUsuarioCognito(
  email: string,
  nombre: string,
  rol: RolUsuario,
): Promise<string> {
  const userPoolId = requirePoolId()
  const client = getClient()

  let sub: string
  try {
    const { User } = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: nombre },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
        // Left unset on purpose: Cognito auto-generates a temporary password
        // and emails it. The app's login screen already handles the
        // "set a new password" challenge that forces on first sign-in.
      }),
    )
    const subAttr = User?.Attributes?.find((a) => a.Name === 'sub')?.Value
    if (!subAttr) {
      throw new CognitoUserError(502, 'respuesta_inesperada', 'Cognito no devolvió el sub del usuario.')
    }
    sub = subAttr
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      throw new CognitoUserError(
        409,
        'usuario_duplicado',
        'Ya existe una cuenta de Cognito con ese correo.',
      )
    }
    throw err
  }

  await client.send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: rol }),
  )

  return sub
}

/** Moves a user between role groups (their existing group is not known, so both are attempted). */
export async function cambiarGrupoCognito(
  email: string,
  rolAnterior: RolUsuario,
  rolNuevo: RolUsuario,
): Promise<void> {
  if (rolAnterior === rolNuevo) return
  const userPoolId = requirePoolId()
  const client = getClient()

  await client
    .send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: rolAnterior }))
    .catch(() => {
      // Already out of that group, or the group assignment drifted — either
      // way, adding them to the new one below is what actually matters.
    })
  await client.send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: rolNuevo }),
  )
}

export async function eliminarUsuarioCognito(email: string): Promise<void> {
  const userPoolId = requirePoolId()
  const client = getClient()
  await client
    .send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }))
    .catch((err) => {
      // If the Cognito account is already gone, that's fine — the goal (no
      // orphaned account) is already met. Anything else should surface.
      if ((err as { name?: string }).name !== 'UserNotFoundException') throw err
    })
}
