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

/** What resolving a Cognito token against `usuarios` can come back with. */
type ResolucionUsuario =
  | { ok: true; user: UsuarioAutenticado }
  | { ok: false; status: 401; body: { error: string; message: string } }
  | {
      ok: false
      status: 403
      body: { error: string; message: string }
      /** What we know even though the role/scope isn't usable yet — enough for `/me` to show a name and a logout button. */
      parcial: { sub: string; nombre: string; email: string; rol: RolUsuario | null }
    }

/**
 * Verifies the token and resolves the app user, without deciding whether
 * that's enough to use the app — `requireAuth` below makes that call for
 * every data route. Split out so `/me` can use the same verification but
 * answer 200 with whatever it knows even when the role or scope is
 * incomplete: otherwise a user stuck in that state never gets `req.user`
 * on the frontend, `useAuth` never sees them as logged in, and the "Salir"
 * button (which only renders once there's a `usuario`) never appears —
 * there'd be no way out of the app short of clearing cookies by hand.
 */
async function resolverUsuario(req: Request): Promise<ResolucionUsuario> {
  if (AUTH_MODE === 'dev') {
    return { ok: true, user: await usuarioDev(req) }
  }

  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) {
    return { ok: false, status: 401, body: { error: 'no_autenticado', message: 'Falta el token' } }
  }

  // Only a failure to verify the token is a 401. Everything after it (the
  // database read, above all) must surface as itself: answering 401 to a
  // broken query tells the user their session expired and sends them to
  // re-login forever while the real error stays invisible.
  let payload: Awaited<ReturnType<ReturnType<typeof getVerifier>['verify']>>
  try {
    payload = await getVerifier().verify(header.slice('Bearer '.length))
  } catch {
    return { ok: false, status: 401, body: { error: 'token_invalido', message: 'Token inválido o expirado' } }
  }

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
  const nombre = fila?.nombre ?? String(payload.name ?? payload.email ?? payload.sub)
  const email = fila?.email ?? String(payload.email ?? '')

  if (!rol) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'sin_rol',
        message: 'El usuario no tiene rol asignado. Pedile a un administrador que te dé de alta.',
      },
      parcial: { sub: String(payload.sub), nombre, email, rol: null },
    }
  }

  // A scoped role without its scope would otherwise fall through to "see
  // everything" — refuse instead of leaking.
  const scopeFaltante =
    (rol === 'empresa' && fila?.empresa_id == null) ||
    (rol === 'organismo' && fila?.organismo_id == null) ||
    (rol === 'region' && fila?.region_id == null)

  if (scopeFaltante) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'sin_alcance',
        message: `El rol ${rol} necesita tener asignado su alcance. Contactá a un administrador.`,
      },
      parcial: { sub: String(payload.sub), nombre, email, rol },
    }
  }

  return {
    ok: true,
    user: {
      sub: String(payload.sub),
      nombre,
      email,
      rol,
      empresaId: fila?.empresa_id ?? null,
      organismoId: fila?.organismo_id ?? null,
      regionId: fila?.region_id ?? null,
      region: fila?.region ?? null,
    },
  }
}

/**
 * Authentication middleware. Leaves the user on req.user or answers
 * 401/403. Every data route uses this — a role without its scope must never
 * fall through to "see everything", so this is the strict form.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const resolucion = await resolverUsuario(req)
    if (!resolucion.ok) {
      return res.status(resolucion.status).json(resolucion.body)
    }
    req.user = resolucion.user
    return next()
  } catch (err) {
    // Not an auth problem: let the error handler report it as what it is.
    return next(err)
  }
}

/**
 * Same verification as `requireAuth`, but never blocks on a missing
 * role/scope — used only by `GET /me`, so the frontend can always find out
 * who's signed in (and offer "Salir") even when that person isn't set up
 * to use the app yet. Still answers 401 for a missing/invalid token: there's
 * no "who" to report in that case.
 */
export async function identificar(req: Request, res: Response, next: NextFunction) {
  try {
    const resolucion = await resolverUsuario(req)
    if (resolucion.ok) {
      req.user = resolucion.user
      return next()
    }
    if (resolucion.status === 401) {
      return res.status(401).json(resolucion.body)
    }
    // 403 sin_rol / sin_alcance: still identify the person, just not as a usable `req.user`.
    return res.status(200).json({ ...resolucion.parcial, alcanceIncompleto: resolucion.body.message })
  } catch (err) {
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
