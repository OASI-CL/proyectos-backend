import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, puedeAprobar } from '../middleware/scope'
import {
  ApprovalError,
  aprobarSolicitud,
  rechazarSolicitud,
} from '../services/approvals'
import { camelizeRows } from '../lib/camelize'
import { scopeSolicitudes, listSolicitudes, countSolicitudesPendientes } from '../models/approvals'

const router = Router()

/**
 * Change requests (the approval queue). Scoping lives in models/approvals.ts
 * (scopeSolicitudes): OASI/admin see every request, the other roles see the
 * requests that fall inside the scope they already have access to — not just
 * the ones they personally submitted, so a colleague at the same agency can
 * follow up on what the team sent.
 */

/**
 * GET /approvals?estado=pendiente
 */
router.get('/', async (req, res, next) => {
  try {
    const user = req.user!
    const wb = new WhereBuilder()
    scopeSolicitudes(wb, user)

    const estado = typeof req.query.estado === 'string' ? req.query.estado : 'pendiente'
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))

    const rows = await listSolicitudes(pool, wb, estado, limit)

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
    const pendientes = await countSolicitudesPendientes(pool, wb, req.user)
    res.json({ pendientes })
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
