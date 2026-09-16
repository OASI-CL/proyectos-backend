import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopeProyectos } from '../middleware/scope'
import { listMinisterios, listAgencies, listCompaniesWithProjects, listScopedProjectsForCatalog } from '../models/catalog'

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
      listMinisterios(pool).then((rows) => rows.map((r) => ({ id: r.id, name: r.nombre }))),
      listAgencies(pool),
      listCompaniesWithProjects(pool),
      listScopedProjectsForCatalog(pool, projectScope),
    ])

    // Distinct values come from the projects the user can actually see, so a
    // company user does not get dropdown options that return nothing.
    const distinct = (key: 'sector' | 'region' | 'project_status') =>
      [...new Set(projects.map((row) => row[key]).filter(Boolean))].sort()

    res.json({
      ministries,
      agencies: agencies.map((a) => ({
        id: a.id,
        name: a.name,
        ministryId: a.ministry_id,
      })),
      companies,
      sectors: distinct('sector'),
      regions: distinct('region'),
      projectStatuses: distinct('project_status'),
      projects: projects.map((p) => ({
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
