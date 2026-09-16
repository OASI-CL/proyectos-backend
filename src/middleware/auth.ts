import type { Request, Response, NextFunction } from 'express'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { pool } from '../db/client'
import type { RolUsuario } from '../shared/types'

// ----------------------------------------------------------------------------
// The authenticated user, left on req.user
// ----------------------------------------------------------------------------

export interface UsuarioAutenticado {
  sub: string
  nombre: string
  email: string
  rol: RolUsuario
  /** Scope. Only the one matching the role is set. */
  empresaId: number | null
  organismoId: number | null
  region: string | null
}

declare global {
  namespace Express {
    interface Request {
      user?: UsuarioAutenticado
    }
  }
}

// ----------------------------------------------------------------------------
// Auth mode
//
//   AUTH_MODE=dev      -> validates nothing, builds a fake user from headers.
//                         Lets us develop without a Cognito pool.
//   AUTH_MODE=cognito  -> verifies the JWT against the User Pool's JWKS.
//
// Production must always run 'cognito' (see infra/ and DEPLOYMENT.md).
// ----------------------------------------------------------------------------

const AUTH_MODE = process.env.AUTH_MODE ?? 'dev'

let verifierCache: ReturnType<typeof CognitoJwtVerifier.create> | null = null

function getVerifier() {
  if (!verifierCache) {
    verifierCache = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
      tokenUse: 'id',
      clientId: process.env.COGNITO_CLIENT_ID ?? '',
    })
  }
  return verifierCache
}

const ROLES: RolUsuario[] = ['admin', 'oasi', 'organismo', 'empresa', 'region']

/**
 * Maps Cognito groups to the app role. If someone is in several groups the
 * most privileged one wins.
 *
 * The Cognito group is only a fallback: the `usuarios` row is authoritative,
 * because that is where the scope (which company / agency / region) lives and
 * a role without its scope cannot be enforced.
 */
function rolDesdeGrupos(grupos: string[]): RolUsuario | null {
  for (const rol of ROLES) {
    if (grupos.includes(rol)) return rol
  }
  return null
}

/**
 * Fake user for development. The role and scope come from headers so the
 * frontend can offer a role switcher and exercise every view.
 */
function usuarioDev(req: Request): UsuarioAutenticado {
  const rolHeader = req.header('x-dev-rol') as RolUsuario | undefined
  const rol = rolHeader && ROLES.includes(rolHeader) ? rolHeader : 'admin'
  const empresaId = req.header('x-dev-empresa-id')
  const organismoId = req.header('x-dev-organismo-id')
  const region = req.header('x-dev-region')

  return {
    sub: `dev-sub-${rol}`,
    nombre: 'Usuario de desarrollo',
    email: 'dev@oasi.local',
    rol,
    empresaId: empresaId ? Number(empresaId) : null,
    organismoId: organismoId ? Number(organismoId) : null,
    region: region ? decodeURIComponent(region) : null,
  }
}

/**
 * Authentication middleware. Leaves the user on req.user or answers 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (AUTH_MODE === 'dev') {
    req.user = usuarioDev(req)
    return next()
  }

  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'no_autenticado', message: 'Falta el token' })
  }

  try {
    const payload = await getVerifier().verify(header.slice('Bearer '.length))
    const grupos = (payload['cognito:groups'] as string[] | undefined) ?? []
    const rolCognito = rolDesdeGrupos(grupos)

    // The usuarios table complements the JWT with the scope (which company,
    // agency or region the person belongs to).
    const { rows } = await pool.query(
      `SELECT nombre, email, rol, empresa_id, organismo_id, region
         FROM usuarios WHERE cognito_sub = $1`,
      [payload.sub],
    )

    const fila = rows[0]
    const rol = (fila?.rol as RolUsuario | undefined) ?? rolCognito

    if (!rol) {
      return res.status(403).json({
        error: 'sin_rol',
        message: 'El usuario no tiene rol asignado. Pedile a un administrador que te dé de alta.',
      })
    }

    // A scoped role without its scope would otherwise fall through to "see
    // everything" — refuse instead of leaking.
    const scopeFaltante =
      (rol === 'empresa' && fila?.empresa_id == null) ||
      (rol === 'organismo' && fila?.organismo_id == null) ||
      (rol === 'region' && fila?.region == null)

    if (scopeFaltante) {
      return res.status(403).json({
        error: 'sin_alcance',
        message: `El rol ${rol} necesita tener asignado su alcance. Contactá a un administrador.`,
      })
    }

    req.user = {
      sub: String(payload.sub),
      nombre: fila?.nombre ?? String(payload.name ?? payload.email ?? payload.sub),
      email: fila?.email ?? String(payload.email ?? ''),
      rol,
      empresaId: fila?.empresa_id ?? null,
      organismoId: fila?.organismo_id ?? null,
      region: fila?.region ?? null,
    }
    return next()
  } catch {
    return res.status(401).json({ error: 'token_invalido', message: 'Token inválido o expirado' })
  }
}

/**
 * Restricts a route to certain roles. e.g. requireRol('admin')
 */
export function requireRol(...roles: RolUsuario[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'no_autenticado', message: 'Falta el token' })
    }
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'sin_permiso', message: 'No tenés permiso para esta acción' })
    }
    return next()
  }
}
