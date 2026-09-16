import { Router } from 'express'
import { pool } from '../db/client'
import { requireRol } from '../middleware/auth'
import { camelizeRow, camelizeRows } from '../lib/camelize'
import {
  CognitoUserError,
  cambiarGrupoCognito,
  crearUsuarioCognito,
  eliminarUsuarioCognito,
} from '../services/cognitoUsers'
import type { RolUsuario } from '../shared/types'

const router = Router()

/**
 * User administration. Admin only.
 *
 * Creating a user here does both halves: the Cognito account (so the person
 * gets an invite email and can sign in) and the `usuarios` row (the role and
 * the scope — which company / agency / region — that middleware/scope.ts
 * enforces on every query). Before this, the Cognito half had to be done by
 * hand with the AWS CLI (still true for the very first admin, see
 * infra/COGNITO_SETUP.md — there is no admin yet to click the button).
 */

const ROLES: RolUsuario[] = ['admin', 'oasi', 'organismo', 'empresa', 'region']

/** A scoped role is meaningless (and unsafe) without its scope. */
function validarScope(
  rol: RolUsuario,
  empresaId: unknown,
  organismoId: unknown,
  region: unknown,
): string | null {
  if (!ROLES.includes(rol)) return `Rol inválido. Válidos: ${ROLES.join(', ')}`
  if (rol === 'empresa' && !empresaId) return 'El rol empresa necesita una empresa asignada'
  if (rol === 'organismo' && !organismoId) return 'El rol organismo necesita un organismo asignado'
  if (rol === 'region' && !region) return 'El rol region necesita una región asignada'
  return null
}

/** Clears the scope fields that do not belong to the role. */
function normalizarScope(rol: RolUsuario, body: Record<string, unknown>) {
  return {
    empresaId: rol === 'empresa' ? Number(body.empresa_id ?? body.empresaId) : null,
    organismoId: rol === 'organismo' ? Number(body.organismo_id ?? body.organismoId) : null,
    region: rol === 'region' ? String(body.region ?? '') : null,
  }
}

router.get('/', requireRol('admin'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, e.nombre AS empresa_nombre, o.nombre AS organismo_nombre
         FROM usuarios u
         LEFT JOIN empresas e ON e.id = u.empresa_id
         LEFT JOIN organismos o ON o.id = u.organismo_id
        ORDER BY u.nombre`,
    )
    res.json(camelizeRows(rows))
  } catch (err) {
    next(err)
  }
})

/**
 * POST /usuarios — creates the Cognito account (which emails an invite with a
 * temporary password) and the usuarios row, in that order. If the DB insert
 * fails after Cognito succeeds, the Cognito account is rolled back too, so a
 * failed request never leaves an orphaned login nobody can see in this list.
 */
router.post('/', requireRol('admin'), async (req, res, next) => {
  const b = req.body ?? {}
  const rol = b.rol as RolUsuario
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : ''

  if (!email || !nombre) {
    return res.status(400).json({ error: 'datos_invalidos', message: 'Falta nombre o email' })
  }

  const scope = normalizarScope(rol, b)
  const errorScope = validarScope(rol, scope.empresaId, scope.organismoId, scope.region)
  if (errorScope) return res.status(400).json({ error: 'datos_invalidos', message: errorScope })

  let sub: string
  try {
    sub = await crearUsuarioCognito(email, nombre, rol)
  } catch (err) {
    if (err instanceof CognitoUserError) {
      return res.status(err.status).json({ error: err.code, message: err.message })
    }
    return next(err)
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (cognito_sub, nombre, email, rol, empresa_id, organismo_id, region,
                             created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [sub, nombre, email, rol, scope.empresaId, scope.organismoId, scope.region, req.user!.sub],
    )
    res.status(201).json(camelizeRow(rows[0]))
  } catch (err) {
    // The Cognito account exists but the row doesn't — undo it rather than
    // leave a login nobody can see or manage in this screen.
    await eliminarUsuarioCognito(email).catch(() => {})

    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({
        error: 'usuario_duplicado',
        message: 'Ya hay un usuario con esos datos.',
      })
    }
    next(err)
  }
})

/**
 * PATCH /usuarios/:id — changes the role/scope. Also moves the Cognito group
 * membership so the two stay in sync (the DB role is what the backend
 * actually trusts — see middleware/auth.ts — but a stale Cognito group is
 * confusing to debug later, so it is kept aligned anyway).
 */
router.patch('/:id', requireRol('admin'), async (req, res, next) => {
  try {
    const b = req.body ?? {}
    const actual = await pool.query('SELECT * FROM usuarios WHERE id = $1', [Number(req.params.id)])
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Usuario no encontrado' })
    }
    const previo = actual.rows[0]

    const rol = (b.rol ?? previo.rol) as RolUsuario
    const scope = normalizarScope(rol, { ...previo, ...b })
    const errorScope = validarScope(rol, scope.empresaId, scope.organismoId, scope.region)
    if (errorScope) return res.status(400).json({ error: 'datos_invalidos', message: errorScope })

    // Refuse to strip the last admin's own admin role via a self-edit gone
    // wrong — same guard as the delete route.
    if (previo.rol === 'admin' && rol !== 'admin') {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin'`)
      if (rows[0].n <= 1) {
        return res.status(409).json({
          error: 'ultimo_admin',
          message: 'No podés sacarle el rol admin al único administrador.',
        })
      }
    }

    const { rows } = await pool.query(
      `UPDATE usuarios
          SET nombre = COALESCE($1, nombre),
              rol = $2,
              empresa_id = $3,
              organismo_id = $4,
              region = $5,
              updated_by = $6
        WHERE id = $7
        RETURNING *`,
      [
        b.nombre || null, rol,
        scope.empresaId, scope.organismoId, scope.region,
        req.user!.sub, Number(req.params.id),
      ],
    )

    if (rol !== previo.rol) {
      await cambiarGrupoCognito(previo.email, previo.rol as RolUsuario, rol).catch(() => {
        // The DB is the source of truth for authorization (see auth.ts), so
        // a Cognito group that fails to move is not fatal — surfaced via logs,
        // not by failing a role change that already succeeded where it counts.
      })
    }

    res.json(camelizeRow(rows[0]))
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', requireRol('admin'), async (req, res, next) => {
  try {
    const objetivo = await pool.query('SELECT rol, email FROM usuarios WHERE id = $1', [
      Number(req.params.id),
    ])
    if (objetivo.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Usuario no encontrado' })
    }
    if (objetivo.rows[0].rol === 'admin') {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin'`)
      if (rows[0].n <= 1) {
        return res.status(409).json({
          error: 'ultimo_admin',
          message: 'No podés eliminar al único administrador.',
        })
      }
    }

    await pool.query('DELETE FROM usuarios WHERE id = $1', [Number(req.params.id)])
    await eliminarUsuarioCognito(objetivo.rows[0].email).catch(() => {
      // The DB row is gone either way; an orphaned Cognito account can be
      // cleaned up by hand and does not block the person from being removed
      // from the app.
    })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
