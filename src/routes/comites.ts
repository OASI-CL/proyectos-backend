import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos } from '../middleware/scope'

const router = Router()

/**
 * GET /comites — lista de sesiones con su resumen.
 */
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT comite_id, comite_numero, comite_fecha, permisos_en_agenda,
              permisos_resueltos, round(promedio_dias)::int AS promedio_dias
         FROM v_resumen_comite
        ORDER BY comite_numero DESC`,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /comites/:numero — la tabla del comité, calculada A LA FECHA DE ESA
 * SESIÓN (no a hoy). Es lo que reemplaza la hoja "Tablas PPT" del Excel.
 */
router.get('/:numero', async (req, res, next) => {
  try {
    const numero = Number(req.params.numero)

    const sesion = await pool.query(
      `SELECT comite_id, comite_numero, comite_fecha, permisos_en_agenda,
              permisos_resueltos, round(promedio_dias)::int AS promedio_dias
         FROM v_resumen_comite WHERE comite_numero = $1`,
      [numero],
    )

    if (sesion.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Comité no encontrado' })
    }

    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    wb.add((i) => `comite_numero = $${i}`, numero)

    const permisos = await pool.query(
      `SELECT * FROM v_permisos_comite ${wb.where}
        ORDER BY dias_tramitacion DESC NULLS LAST`,
      wb.params,
    )

    res.json({ sesion: sesion.rows[0], permisos: permisos.rows })
  } catch (err) {
    next(err)
  }
})

export default router
