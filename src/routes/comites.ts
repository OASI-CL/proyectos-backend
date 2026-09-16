import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos } from '../middleware/scope'
import { listComites, getComiteByNumero, listPermisosPorComite } from '../models/comites'

const router = Router()

/**
 * GET /comites — lista de sesiones con su resumen.
 */
router.get('/', async (_req, res, next) => {
  try {
    const rows = await listComites(pool)
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

    const sesion = await getComiteByNumero(pool, numero)
    if (!sesion) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Comité no encontrado' })
    }

    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    const permisos = await listPermisosPorComite(pool, wb, numero)

    res.json({ sesion, permisos })
  } catch (err) {
    next(err)
  }
})

export default router
