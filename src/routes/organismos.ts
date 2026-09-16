import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos } from '../middleware/scope'

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

    const { rows } = await pool.query(
      `SELECT
         p.organismo_id,
         p.organismo_nombre,
         p.ministerio_nombre,
         count(*) FILTER (WHERE p.estado = 'Pendiente')::int              AS pendientes,
         count(*) FILTER (WHERE p.estado = 'Pendiente'
                            AND p.supera_6_meses)::int                    AS supera_6_meses,
         round(avg(p.dias_tramitacion)
               FILTER (WHERE p.estado = 'Pendiente'))::int                AS promedio_dias,
         COALESCE((
           SELECT sum(DISTINCT_pr.inversion_mmusd)
             FROM (
               SELECT DISTINCT p2.proyecto_id, p2.inversion_mmusd
                 FROM v_permisos p2
                WHERE p2.organismo_id = p.organismo_id
                  AND p2.estado = 'Pendiente'
             ) AS DISTINCT_pr
         ), 0)                                                            AS inversion_bloqueada_mmusd
       FROM v_permisos p
       ${wb.where}
       GROUP BY p.organismo_id, p.organismo_nombre, p.ministerio_nombre
       ORDER BY pendientes DESC`,
      wb.params,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

export default router
