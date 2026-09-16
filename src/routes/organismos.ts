import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos } from '../middleware/scope'
import { resumenPorOrganismo } from '../models/organismos'

const router = Router()

/**
 * GET /organismos — per-agency summary (pending, over 6 months, average days,
 * blocked investment).
 *
 * Aggregated from v_permisos with the caller's scope applied rather than read
 * off v_resumen_organismo, because that view is global: a 'region' user has
 * to see each agency's numbers *restricted to their region*, not the national
 * totals. Same query then serves every role:
 *   oasi/admin -> all agencies
 *   organismo  -> only its own
 *   region     -> every agency, counting only its region's projects
 *   empresa    -> every agency, counting only its own projects
 */
router.get('/', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    const rows = await resumenPorOrganismo(pool, wb)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

export default router
