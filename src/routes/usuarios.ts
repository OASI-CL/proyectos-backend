import { Router } from 'express'
import { pool } from '../db/client'
import { requireRol } from '../middleware/auth'
import { camelizeRow, camelizeRows } from '../lib/camelize'
import type { RolUsuario } from '../shared/types'

const router = Router()

/**
 * User administration. Admin only.
 *
 * Accounts themselves live in Cognito — this table only carries the app role
 * and the scope (which company / agency / region the person is limited to),
 * which is what the row-level filters in middleware/scope.ts enforce.
 *
 * So the flow to onboard someone is: create them in Cognito, add them to the
 * matching group, then create the row here with their `cognito_sub`.
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

router.post('/', requireRol('admin'), async (req, res, next) => {
  try {
    const b = req.body ?? {}
    const rol = b.rol as RolUsuario

    if (!b.cognito_sub && !b.cognitoSub) {
      return res.status(400).json({
        error: 'datos_invalidos',
        message: 'Falta el cognito_sub (el identificador del usuario en Cognito)',
      })
    }
    if (!b.nombre || !b.email) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'Falta nombre o email' })
    }

    const scope = normalizarScope(rol, b)
    const error = validarScope(rol, scope.empresaId, scope.organismoId, scope.region)
    if (error) return res.status(400).json({ error: 'datos_invalidos', message: error })

    const { rows } = await pool.query(
      `INSERT INTO usuarios (cognito_sub, nombre, email, rol, empresa_id, organismo_id, region,
                             created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [
        b.cognito_sub ?? b.cognitoSub, b.nombre, b.email, rol,
        scope.empresaId, scope.organismoId, scope.region, req.user!.sub,
      ],
    )
    res.status(201).json(camelizeRow(rows[0]))
  } catch (err) {
    // Unique violation on cognito_sub
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({
        error: 'usuario_duplicado',
        message: 'Ese usuario de Cognito ya está dado de alta.',
      })
    }
    next(err)
  }
})

router.patch('/:id', requireRol('admin'), async (req, res, next) => {
  try {
    const b = req.body ?? {}
    const actual = await pool.query('SELECT * FROM usuarios WHERE id = $1', [Number(req.params.id)])
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Usuario no encontrado' })
    }

    const rol = (b.rol ?? actual.rows[0].rol) as RolUsuario
    const scope = normalizarScope(rol, { ...actual.rows[0], ...b })
    const error = validarScope(rol, scope.empresaId, scope.organismoId, scope.region)
    if (error) return res.status(400).json({ error: 'datos_invalidos', message: error })

    const { rows } = await pool.query(
      `UPDATE usuarios
          SET nombre = COALESCE($1, nombre),
              email = COALESCE($2, email),
              rol = $3,
              empresa_id = $4,
              organismo_id = $5,
              region = $6,
              updated_by = $7
        WHERE id = $8
        RETURNING *`,
      [
        b.nombre ?? null, b.email ?? null, rol,
        scope.empresaId, scope.organismoId, scope.region,
        req.user!.sub, Number(req.params.id),
      ],
    )
    res.json(camelizeRow(rows[0]))
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', requireRol('admin'), async (req, res, next) => {
  try {
    // Do not let an admin lock everyone out by deleting the last one.
    const objetivo = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [
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
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
