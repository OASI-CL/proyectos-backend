import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, puedeAprobar } from '../middleware/scope'
import {
  ApprovalError,
  aprobarSolicitud,
  rechazarSolicitud,
} from '../services/approvals'
import { camelizeRows } from '../lib/camelize'

const router = Router()

/**
 * Change requests (the approval queue).
 *
 * OASI/admin see every request. The other roles see the requests that fall
 * inside the scope they already have access to — not just the ones they
 * personally submitted, so a colleague at the same agency can follow up on
 * what the team sent. Scoping by entity (rather than by submitter) also means
 * the queue can never show a record the user is not allowed to read.
 */
function scopeSolicitudes(wb: WhereBuilder, user: Express.Request['user']) {
  if (!user || puedeAprobar(user)) return wb

  if (user.rol === 'empresa') {
    wb.add((n) => `empresa_id = $${n}`, user.empresaId ?? -1)
  } else if (user.rol === 'organismo') {
    wb.add((n) => `organismo_id = $${n}`, user.organismoId ?? -1)
  } else if (user.rol === 'region') {
    wb.add((n) => `region = $${n}`, user.region ?? '')
  }
  return wb
}

/**
 * GET /approvals?estado=pendiente
 */
router.get('/', async (req, res, next) => {
  try {
    const user = req.user!
    const wb = new WhereBuilder()
    scopeSolicitudes(wb, user)

    const estado = typeof req.query.estado === 'string' ? req.query.estado : 'pendiente'
    if (estado !== 'todas') {
      wb.add((n) => `estado = $${n}`, estado)
    }

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
    const limitIdx = wb.push(limit)

    const { rows } = await pool.query(
      `SELECT * FROM v_solicitudes_cambio ${wb.where}
        ORDER BY solicitado_at DESC
        LIMIT $${limitIdx}`,
      wb.params,
    )

    res.json(camelizeRows(rows))
  } catch (err) {
    next(err)
  }
})

/**
 * GET /approvals/count — badge for the nav bar.
 */
router.get('/count', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    wb.addRaw(`estado = 'pendiente'`)
    scopeSolicitudes(wb, req.user)

    const { rows } = await pool.query(
      `SELECT count(*)::int AS pendientes FROM v_solicitudes_cambio ${wb.where}`,
      wb.params,
    )
    res.json({ pendientes: rows[0].pendientes })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /approvals/:id/approve
 */
router.post('/:id/approve', async (req, res, next) => {
  try {
    if (!puedeAprobar(req.user!)) {
      return res.status(403).json({
        error: 'sin_permiso',
        message: 'Solo OASI y los administradores pueden aprobar solicitudes.',
      })
    }

    const solicitud = await aprobarSolicitud(
      Number(req.params.id),
      req.user!,
      typeof req.body?.comentario === 'string' ? req.body.comentario : undefined,
    )
    res.json(solicitud)
  } catch (err) {
    if (err instanceof ApprovalError) {
      return res.status(err.status).json({ error: err.code, message: err.message })
    }
    next(err)
  }
})

/**
 * POST /approvals/:id/reject
 */
router.post('/:id/reject', async (req, res, next) => {
  try {
    if (!puedeAprobar(req.user!)) {
      return res.status(403).json({
        error: 'sin_permiso',
        message: 'Solo OASI y los administradores pueden rechazar solicitudes.',
      })
    }

    const solicitud = await rechazarSolicitud(
      Number(req.params.id),
      req.user!,
      typeof req.body?.comentario === 'string' ? req.body.comentario : undefined,
    )
    res.json(solicitud)
  } catch (err) {
    if (err instanceof ApprovalError) {
      return res.status(err.status).json({ error: err.code, message: err.message })
    }
    next(err)
  }
})

export default router
