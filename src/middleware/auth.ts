import type { Request, Response, NextFunction } from 'express'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { pool } from '../db/client'
import type { RolUsuario } from '../shared/types'

// ----------------------------------------------------------------------------
// Usuario autenticado que queda en req.user
// ----------------------------------------------------------------------------

export interface UsuarioAutenticado {
  sub: string
  nombre: string
  email: string
  rol: RolUsuario
  empresaId: number | null
  organismoId: number | null
}

declare global {
  namespace Express {
    interface Request {
      user?: UsuarioAutenticado
    }
  }
}

// ----------------------------------------------------------------------------
// Modo de autenticación
//
//   AUTH_MODE=dev      -> no valida nada, arma un usuario falso desde headers.
//                          Sirve para desarrollar sin tener Cognito montado.
//   AUTH_MODE=cognito  -> valida el JWT contra el JWKS del User Pool.
//
// En producción SIEMPRE debe ir en 'cognito'.
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

/**
 * Traduce los grupos de Cognito al rol de la app. Si alguien está en varios
 * grupos gana el de mayor privilegio.
 */
function rolDesdeGrupos(grupos: string[]): RolUsuario | null {
  if (grupos.includes('admin')) return 'admin'
  if (grupos.includes('oasi')) return 'oasi'
  if (grupos.includes('organismo_lector')) return 'organismo_lector'
  if (grupos.includes('empresa')) return 'empresa'
  return null
}

/**
 * Usuario falso para desarrollo. El rol y el scope se controlan por headers,
 * así el frontend puede tener un selector de rol para probar cada vista.
 */
function usuarioDev(req: Request): UsuarioAutenticado {
  const rol = (req.header('x-dev-rol') as RolUsuario | undefined) ?? 'admin'
  const empresaId = req.header('x-dev-empresa-id')
  const organismoId = req.header('x-dev-organismo-id')

  return {
    sub: 'dev-sub-local',
    nombre: 'Usuario de desarrollo',
    email: 'dev@oasi.local',
    rol,
    empresaId: empresaId ? Number(empresaId) : null,
    organismoId: organismoId ? Number(organismoId) : null,
  }
}

/**
 * Middleware de autenticación. Deja el usuario en req.user o responde 401.
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

    // La tabla usuarios complementa el JWT con el scope (a qué empresa u
    // organismo pertenece la persona).
    const { rows } = await pool.query(
      `SELECT nombre, email, rol, empresa_id, organismo_id
         FROM usuarios WHERE cognito_sub = $1`,
      [payload.sub],
    )

    if (rows.length === 0 && rolCognito === null) {
      return res.status(403).json({ error: 'sin_rol', message: 'El usuario no tiene rol asignado' })
    }

    const fila = rows[0]
    req.user = {
      sub: String(payload.sub),
      nombre: fila?.nombre ?? String(payload.name ?? payload.email ?? payload.sub),
      email: fila?.email ?? String(payload.email ?? ''),
      // El rol de la tabla manda sobre el grupo de Cognito si están los dos.
      rol: (fila?.rol as RolUsuario) ?? rolCognito!,
      empresaId: fila?.empresa_id ?? null,
      organismoId: fila?.organismo_id ?? null,
    }
    return next()
  } catch (err) {
    return res.status(401).json({ error: 'token_invalido', message: 'Token inválido o expirado' })
  }
}

/**
 * Restringe una ruta a ciertos roles. Ej: requireRol('admin')
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
