import { Router } from 'express'
import { pool } from '../db/client'
import { rcaStatusSql } from '../db/sql'
import { WhereBuilder, scopeProyectos } from '../middleware/scope'

const router = Router()

/**
 * GET /catalog
 *
 * Everything the dashboard filter bar needs, in one request.
 *
 * The filter dropdowns are dependent on each other (pick a ministry and the
 * agency list narrows, pick a company and the project list narrows). Rather
 * than a round trip per dropdown change, we ship the small relational
 * skeleton once and derive the cascade in the browser: the lists are tiny
 * (12 ministries, 19 agencies, ~112 companies, 317 projects) and it makes
 * the filter bar feel instant.
 *
 * Each project carries the ids of the agencies it has permits with, so the
 * ministry/agency cascade can be resolved client-side too.
 */
router.get('/', async (req, res, next) => {
  try {
    const projectScope = new WhereBuilder()
    scopeProyectos(projectScope, req.user!)

    const [ministries, agencies, companies, projects] = await Promise.all([
      pool.query('SELECT id, nombre AS name FROM ministerios ORDER BY nombre'),

      pool.query(`
        SELECT o.id, o.nombre AS name, o.ministerio_id AS ministry_id
          FROM organismos o
         ORDER BY o.nombre
      `),

      pool.query(`
        SELECT e.id, e.nombre AS name
          FROM empresas e
         WHERE EXISTS (SELECT 1 FROM proyectos pr WHERE pr.empresa_id = e.id)
         ORDER BY e.nombre
      `),

      pool.query(
        `SELECT
           pr.id,
           pr.id_excel,
           pr.nombre                                  AS name,
           pr.empresa_id                              AS company_id,
           pr.sector,
           pr.region,
           pr.etapa                                   AS project_status,
           (${rcaStatusSql('pr.estado_ambiental')})   AS rca_status,
           -- ::int[] so the driver returns numbers; the int8 array parser
           -- would hand back strings.
           COALESCE(
             (SELECT array_agg(DISTINCT pe.organismo_id)::int[]
                FROM permisos pe WHERE pe.proyecto_id = pr.id),
             '{}'
           )                                          AS agency_ids
         FROM v_proyectos pr
         ${projectScope.where}
         ORDER BY pr.nombre`,
        projectScope.params,
      ),
    ])

    // Distinct values come from the projects the user can actually see, so a
    // company user does not get dropdown options that return nothing.
    const distinct = (key: 'sector' | 'region' | 'project_status') =>
      [...new Set(projects.rows.map((row) => row[key]).filter(Boolean))].sort()

    res.json({
      ministries: ministries.rows,
      agencies: agencies.rows.map((a) => ({
        id: a.id,
        name: a.name,
        ministryId: a.ministry_id,
      })),
      companies: companies.rows,
      sectors: distinct('sector'),
      regions: distinct('region'),
      projectStatuses: distinct('project_status'),
      projects: projects.rows.map((p) => ({
        id: p.id,
        idExcel: p.id_excel,
        name: p.name,
        companyId: p.company_id,
        sector: p.sector,
        region: p.region,
        projectStatus: p.project_status,
        rcaStatus: p.rca_status,
        agencyIds: p.agency_ids ?? [],
      })),
    })
  } catch (err) {
    next(err)
  }
})

export default router
