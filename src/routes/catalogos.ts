import { Router } from 'express'
import { pool } from '../db/client'

const router = Router()

/**
 * GET /catalogos — todo lo que necesitan los dropdowns de filtros del
 * frontend, en una sola llamada (son listas chicas y casi estáticas).
 */
router.get('/', async (_req, res, next) => {
  try {
    const [organismos, ministerios, empresas, regiones, sectores, etapas] = await Promise.all([
      pool.query(
        `SELECT o.id, o.nombre, o.ministerio_id, m.nombre AS ministerio_nombre
           FROM organismos o JOIN ministerios m ON m.id = o.ministerio_id
          ORDER BY o.nombre`,
      ),
      pool.query('SELECT id, nombre FROM ministerios ORDER BY nombre'),
      pool.query('SELECT id, id_excel, nombre FROM empresas ORDER BY nombre'),
      pool.query(
        `SELECT DISTINCT region AS valor FROM proyectos
          WHERE region IS NOT NULL ORDER BY valor`,
      ),
      pool.query(
        `SELECT DISTINCT sector AS valor FROM proyectos
          WHERE sector IS NOT NULL ORDER BY valor`,
      ),
      pool.query(
        `SELECT DISTINCT etapa AS valor FROM proyectos
          WHERE etapa IS NOT NULL ORDER BY valor`,
      ),
    ])

    res.json({
      organismos: organismos.rows,
      ministerios: ministerios.rows,
      empresas: empresas.rows,
      regiones: regiones.rows.map((r) => r.valor),
      sectores: sectores.rows.map((r) => r.valor),
      etapas: etapas.rows.map((r) => r.valor),
      estados: ['Pendiente', 'Resuelto', 'Descartado'],
    })
  } catch (err) {
    next(err)
  }
})

export default router
