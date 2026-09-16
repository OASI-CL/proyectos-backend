import { Router } from 'express'
import { pool } from '../db/client'
import {
  listOrganismosConMinisterio,
  listMinisterios,
  listEmpresas,
  listDistinctProyectoValues,
} from '../models/catalog'

const router = Router()

/**
 * GET /catalogos — todo lo que necesitan los dropdowns de filtros del
 * frontend, en una sola llamada (son listas chicas y casi estáticas).
 */
router.get('/', async (_req, res, next) => {
  try {
    const [organismos, ministerios, empresas, regiones, sectores, etapas] = await Promise.all([
      listOrganismosConMinisterio(pool),
      listMinisterios(pool),
      listEmpresas(pool),
      listDistinctProyectoValues(pool, 'region'),
      listDistinctProyectoValues(pool, 'sector'),
      listDistinctProyectoValues(pool, 'etapa'),
    ])

    res.json({
      organismos,
      ministerios,
      empresas,
      regiones,
      sectores,
      etapas,
      estados: ['Pendiente', 'Resuelto', 'Descartado'],
    })
  } catch (err) {
    next(err)
  }
})

export default router
