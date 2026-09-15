import { Router } from 'express'
import { pool } from '../db/client'

const router = Router()

/**
 * GET /organismos — resumen por organismo (pendientes, +6 meses, promedio de
 * días, inversión bloqueada). Un organismo_lector solo ve el suyo.
 */
router.get('/', async (req, res, next) => {
  try {
    const user = req.user!
    const filtro = user.rol === 'organismo_lector' ? 'WHERE organismo_id = $1' : ''
    const params = user.rol === 'organismo_lector' ? [user.organismoId ?? -1] : []

    const { rows } = await pool.query(
      `SELECT r.organismo_id, r.organismo_nombre, m.nombre AS ministerio_nombre,
              r.pendientes, r.supera_6_meses,
              round(r.promedio_dias)::int AS promedio_dias,
              r.inversion_bloqueada_mmusd
         FROM v_resumen_organismo r
         JOIN organismos o ON o.id = r.organismo_id
         JOIN ministerios m ON m.id = o.ministerio_id
         ${filtro}
        ORDER BY r.pendientes DESC`,
      params,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

export default router
