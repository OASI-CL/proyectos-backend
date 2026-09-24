import { Router } from 'express'
import type { Request } from 'express'
import { pool } from '../db/client'
import { camelizeRow, camelizeRows } from '../lib/camelize'
import { fetchDashboard, type DashboardFilters } from '../models/dashboard'

const router = Router()

function parseFilters(req: Request): DashboardFilters {
  const q = req.query
  const str = (key: string): string | undefined => {
    const value = q[key]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }
  const num = (key: string): number | undefined => {
    const value = str(key)
    if (value === undefined) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return {
    ministryId: num('ministryId'),
    agencyId: num('agencyId'),
    sector: str('sector'),
    region: str('region'),
    projectStatus: str('projectStatus'),
    permitStatus: str('permitStatus'),
    companyId: num('companyId'),
    projectId: num('projectId'),
    rcaStatus: str('rcaStatus'),
    startDateFrom: str('startDateFrom'),
    startDateTo: str('startDateTo'),
  }
}

// ----------------------------------------------------------------------------
// GET /dashboard
// ----------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const filters = parseFilters(req)
    const data = await fetchDashboard(pool, req.user!, filters)

    const bucket = (name: 'upcoming') => {
      const row = data.monitor.find((r) => r.bucket === name) as
        | { project_count: number; investment_mmusd: unknown; construction_jobs: number; operation_jobs: number; projects: unknown[] }
        | undefined
      if (!row) {
        return {
          projectCount: 0,
          investmentMmusd: 0,
          constructionJobs: 0,
          operationJobs: 0,
          projects: [],
        }
      }
      return {
        projectCount: row.project_count,
        investmentMmusd: Number(row.investment_mmusd),
        constructionJobs: row.construction_jobs,
        operationJobs: row.operation_jobs,
        // json_agg already builds camelCase keys inside the query
        projects: row.projects ?? [],
      }
    }

    res.json({
      kpis: camelizeRow(data.kpis),
      projectsByRegion: camelizeRows(data.projectsByRegion),
      projectsBySector: camelizeRows(data.projectsBySector),
      rcaStatus: camelizeRows(data.rcaStatus),
      timeline: camelizeRows(data.timeline),
      mapProjects: camelizeRows(data.mapProjects),
      monitor: { upcoming: bucket('upcoming') },
      permitsByAgency: camelizeRows(data.permitsByAgency),
      permitsByRegion: camelizeRows(data.permitsByRegion),
      permitStatus: camelizeRows(data.permitStatus),
      criticalPermits: camelizeRows(data.criticalPermits),
    })
  } catch (err) {
    next(err)
  }
})

export default router
