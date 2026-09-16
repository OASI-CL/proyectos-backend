import { Router } from 'express'
import { pool } from '../db/client'
import {
  listOrganismosConMinisterio,
  listMinisterios,
  listEmpresas,
  listRegiones,
  listSectores,
  listEtapas,
  listEstadosPermiso,
} from '../models/catalog'

const router = Router()

/**
 * GET /catalogos — todo lo que necesitan los dropdowns de filtros del
 * frontend, en una sola llamada (son listas chicas y casi estáticas).
 *
 * `regiones`, `sectores`, `etapas` y `estados` ahora son objetos
 * `{ id, nombre }` en vez de strings sueltos: los formularios de alta
 * necesitan el id (proyectos.region_id, permisos.estado_id) y las barras de
 * filtro siguen usando el nombre. Vienen en el orden del catálogo, no
 * alfabético — regiones de norte a sur, etapas por avance real del proyecto.
 */
router.get('/', async (_req, res, next) => {
  try {
    const [organismos, ministerios, empresas, regiones, sectores, etapas, estados] =
      await Promise.all([
        listOrganismosConMinisterio(pool),
        listMinisterios(pool),
        listEmpresas(pool),
        listRegiones(pool),
        listSectores(pool),
        listEtapas(pool),
        listEstadosPermiso(pool),
      ])

    res.json({ organismos, ministerios, empresas, regiones, sectores, etapas, estados })
  } catch (err) {
    next(err)
  }
})

export default router
