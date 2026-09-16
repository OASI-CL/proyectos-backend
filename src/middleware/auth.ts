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
  /**
   * Scope of the 'region' role, as the catalog id. Every row filter uses this
   * (indexed integer comparison, immune to accent/spelling drift).
   */
  regionId: number | null
  /** Same region, resolved to its name. Display only — never filter on it. */
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
 *
 * `x-dev-region` now carries the REGION ID (a number), not the name — the
 * header name is kept so nothing else (CORS allowlist, the frontend
 * interceptor) had to be renamed. The readable name is looked up from the
 * catalog so /me still has something to display.
 */
async function usuarioDev(req: Request): Promise<UsuarioAutenticado> {
  const rolHeader = req.header('x-dev-rol') as RolUsuario | undefined
  const rol = rolHeader && ROLES.includes(rolHeader) ? rolHeader : 'admin'
  const empresaId = req.header('x-dev-empresa-id')
  const organismoId = req.header('x-dev-organismo-id')
  const regionHeader = req.header('x-dev-region')
  const regionId =
    regionHeader && !Number.isNaN(Number(regionHeader)) ? Number(regionHeader) : null

  let region: string | null = null
  if (regionId !== null) {
    const { rows } = await pool.query('SELECT nombre FROM regiones WHERE id = $1', [regionId])
    region = rows[0]?.nombre ?? null
  }

  return {
    sub: `dev-sub-${rol}`,
    nombre: 'Usuario de desarrollo',
    email: 'dev@oasi.local',
    rol,
    empresaId: empresaId ? Number(empresaId) : null,
    organismoId: organismoId ? Number(organismoId) : null,
    regionId,
    region,
  }
}

/**
 * Authentication middleware. Leaves the user on req.user or answers 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (AUTH_MODE === 'dev') {
    req.user = await usuarioDev(req)
    return next()
  }

  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'no_autenticado', message: 'Falta el token' })
  }

  // Only a failure to verify the token is a 401. Everything after it (the
  // database read, above all) must surface as itself: answering 401 to a
  // broken query tells the user their session expired and sends them to
  // re-login forever while the real error stays invisible.
  let payload: Awaited<ReturnType<ReturnType<typeof getVerifier>['verify']>>
  try {
    payload = await getVerifier().verify(header.slice('Bearer '.length))
  } catch {
    return res.status(401).json({ error: 'token_invalido', message: 'Token inválido o expirado' })
  }

  try {
    const grupos = (payload['cognito:groups'] as string[] | undefined) ?? []
    const rolCognito = rolDesdeGrupos(grupos)

    // The usuarios table complements the JWT with the scope (which company,
    // agency or region the person belongs to). Read through v_usuarios so the
    // region comes back both as its id (what the filters use) and as its name.
    const { rows } = await pool.query(
      `SELECT nombre, email, rol, empresa_id, organismo_id, region_id, region
         FROM v_usuarios WHERE cognito_sub = $1`,
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
      (rol === 'region' && fila?.region_id == null)

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
      regionId: fila?.region_id ?? null,
      region: fila?.region ?? null,
    }
    return next()
  } catch (err) {
    // Not an auth problem: let the error handler report it as what it is.
    return next(err)
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
