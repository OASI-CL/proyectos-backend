import { Router } from 'express'
import type { Request } from 'express'
import { pool } from '../db/client'
import {
  SqlParams,
  PERMIT_TRACKING_STATUS_SQL,
  OVERDUE_DAYS_SQL,
  rcaStatusSql,
} from '../db/sql'
import type { UsuarioAutenticado } from '../middleware/auth'
import { camelizeRow, camelizeRows } from '../lib/camelize'

const router = Router()

// ----------------------------------------------------------------------------
// Global filters
//
// The whole dashboard is driven by a single filter set (see README_dashboard
// section 12): every section recomputes against the same filtered universe.
// ----------------------------------------------------------------------------

interface DashboardFilters {
  ministryId?: number
  agencyId?: number
  sector?: string
  region?: string
  projectStatus?: string
  permitStatus?: string
  companyId?: number
  projectId?: number
  rcaStatus?: string
}

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
  }
}

/** Filters that live on the permit, not on the project. */
function hasPermitLevelFilter(filters: DashboardFilters): boolean {
  return (
    filters.ministryId !== undefined ||
    filters.agencyId !== undefined ||
    filters.permitStatus !== undefined
  )
}

/**
 * Builds the CTE prelude shared by every dashboard query.
 *
 * `scored_permits` classifies each permit into the three tracking states.
 * `permits` applies the tracking-state filter (which can only be applied
 * after the CASE is computed). `projects` applies the project-level filters
 * and, when a permit-level filter is active, keeps only projects that still
 * have at least one matching permit — that is what makes the filter set
 * behave as one interconnected system.
 */
function buildScope(user: UsuarioAutenticado, filters: DashboardFilters) {
  const sql = new SqlParams()
  const permitWhere: string[] = []
  const projectWhere: string[] = []

  // --- Role scoping: never trust the frontend to filter (see scope.ts) ---
  if (user.rol === 'empresa') {
    permitWhere.push(`p.empresa_id = ${sql.add(user.empresaId ?? -1)}`)
    projectWhere.push(`pr.empresa_id = ${sql.add(user.empresaId ?? -1)}`)
  } else if (user.rol === 'organismo_lector') {
    const agency = sql.add(user.organismoId ?? -1)
    permitWhere.push(`p.organismo_id = ${agency}`)
    projectWhere.push(`pr.id IN (SELECT proyecto_id FROM permisos WHERE organismo_id = ${agency})`)
  }

  // --- Permit-level filters ---
  if (filters.ministryId !== undefined) {
    permitWhere.push(`p.ministerio_id = ${sql.add(filters.ministryId)}`)
  }
  if (filters.agencyId !== undefined) {
    permitWhere.push(`p.organismo_id = ${sql.add(filters.agencyId)}`)
  }

  // --- Project-level filters: applied to both sides so the two universes
  //     always describe the same selection ---
  if (filters.sector !== undefined) {
    const value = sql.add(filters.sector)
    permitWhere.push(`p.sector = ${value}`)
    projectWhere.push(`pr.sector = ${value}`)
  }
  if (filters.region !== undefined) {
    const value = sql.add(filters.region)
    permitWhere.push(`p.region = ${value}`)
    projectWhere.push(`pr.region = ${value}`)
  }
  if (filters.projectStatus !== undefined) {
    const value = sql.add(filters.projectStatus)
    permitWhere.push(`p.etapa = ${value}`)
    projectWhere.push(`pr.etapa = ${value}`)
  }
  if (filters.companyId !== undefined) {
    const value = sql.add(filters.companyId)
    permitWhere.push(`p.empresa_id = ${value}`)
    projectWhere.push(`pr.empresa_id = ${value}`)
  }
  if (filters.projectId !== undefined) {
    const value = sql.add(filters.projectId)
    permitWhere.push(`p.proyecto_id = ${value}`)
    projectWhere.push(`pr.id = ${value}`)
  }
  if (filters.rcaStatus !== undefined) {
    const value = sql.add(filters.rcaStatus)
    projectWhere.push(`(${rcaStatusSql('pr.estado_ambiental')}) = ${value}`)
    permitWhere.push(
      `p.proyecto_id IN (SELECT id FROM proyectos
         WHERE (${rcaStatusSql('estado_ambiental')}) = ${value})`,
    )
  }

  // --- Tracking-state filter, applied after the CASE is computed ---
  const trackingWhere =
    filters.permitStatus !== undefined
      ? `WHERE tracking_status = ${sql.add(filters.permitStatus)}`
      : ''

  // --- Projects must still have a matching permit when a permit-level
  //     filter is on ---
  if (hasPermitLevelFilter(filters)) {
    projectWhere.push('pr.id IN (SELECT project_id FROM permits)')
  }

  const cte = `
    WITH scored_permits AS (
      SELECT
        p.id,
        p.id_excel,
        p.nombre                     AS name,
        p.proyecto_id                AS project_id,
        p.organismo_id               AS agency_id,
        p.organismo_nombre           AS agency_name,
        p.ministerio_id              AS ministry_id,
        p.ministerio_nombre          AS ministry_name,
        p.proyecto_nombre            AS project_name,
        p.empresa_id                 AS company_id,
        p.empresa_nombre             AS company_name,
        p.region,
        p.sector,
        p.etapa                      AS project_status,
        p.inversion_mmusd            AS investment_mmusd,
        p.estado                     AS raw_status,
        p.fecha_ingreso              AS submitted_on,
        p.fecha_resolucion_estimada  AS expected_resolution_on,
        p.fecha_resolucion           AS resolved_on,
        p.dias_tramitacion           AS days_in_process,
        p.critico                    AS is_critical,
        (${PERMIT_TRACKING_STATUS_SQL}) AS tracking_status,
        (${OVERDUE_DAYS_SQL})           AS overdue_days
      FROM v_permisos p
      ${permitWhere.length ? `WHERE ${permitWhere.join(' AND ')}` : ''}
    ),
    permits AS (
      SELECT * FROM scored_permits ${trackingWhere}
    ),
    projects AS (
      SELECT
        pr.id,
        pr.id_excel,
        pr.nombre                       AS name,
        pr.empresa_id                   AS company_id,
        pr.empresa_nombre               AS company_name,
        pr.region,
        pr.sector,
        pr.etapa                        AS project_status,
        pr.inversion_mmusd              AS investment_mmusd,
        pr.empleo_construccion          AS construction_jobs,
        pr.empleo_operacion             AS operation_jobs,
        pr.fecha_inicio_construccion    AS construction_start_on,
        pr.total_permisos               AS permit_count,
        pr.permisos_pendientes          AS pending_permit_count,
        (${rcaStatusSql('pr.estado_ambiental')}) AS rca_status
      FROM v_proyectos pr
      ${projectWhere.length ? `WHERE ${projectWhere.join(' AND ')}` : ''}
    )`

  return { cte, params: sql.params }
}

// ----------------------------------------------------------------------------
// GET /dashboard
// ----------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const filters = parseFilters(req)
    const { cte, params } = buildScope(req.user!, filters)

    const run = (select: string) => pool.query(`${cte} ${select}`, params)

    const [
      kpis,
      projectsByRegion,
      projectsBySector,
      rcaStatus,
      timeline,
      monitor,
      permitsByAgency,
      permitsByRegion,
      permitStatus,
      criticalPermits,
    ] = await Promise.all([
      // --- 2. Top summary ---
      run(`
        SELECT
          (SELECT count(*)::int FROM projects)                                          AS project_count,
          (SELECT COALESCE(sum(investment_mmusd), 0)::numeric FROM projects)            AS investment_mmusd,
          (SELECT COALESCE(sum(construction_jobs), 0)::int FROM projects)               AS construction_jobs,
          (SELECT COALESCE(sum(operation_jobs), 0)::int FROM projects)                  AS operation_jobs,
          (SELECT count(*)::int FROM permits)                                           AS permit_count,
          (SELECT count(*)::int FROM permits WHERE tracking_status = 'overdue')         AS overdue_permit_count,
          (SELECT count(*)::int FROM permits WHERE tracking_status = 'pending')         AS pending_permit_count,
          (SELECT count(*)::int FROM permits WHERE tracking_status = 'resolved')        AS resolved_permit_count
      `),

      // --- 3.1 Projects by region ---
      run(`
        SELECT
          COALESCE(region, 'Sin región')            AS region,
          count(*)::int                             AS project_count,
          COALESCE(sum(investment_mmusd), 0)::numeric AS investment_mmusd,
          COALESCE(sum(construction_jobs), 0)::int  AS construction_jobs,
          COALESCE(sum(operation_jobs), 0)::int     AS operation_jobs
        FROM projects
        GROUP BY 1
        ORDER BY project_count DESC
      `),

      // --- 3.2 Projects by sector ---
      run(`
        SELECT
          COALESCE(sector, 'Sin sector')            AS sector,
          count(*)::int                             AS project_count,
          COALESCE(sum(investment_mmusd), 0)::numeric AS investment_mmusd,
          COALESCE(sum(construction_jobs), 0)::int  AS construction_jobs,
          COALESCE(sum(operation_jobs), 0)::int     AS operation_jobs
        FROM projects
        GROUP BY 1
        ORDER BY project_count DESC
      `),

      // --- 3.3 RCA status ---
      run(`
        SELECT
          rca_status,
          count(*)::int                             AS project_count,
          COALESCE(sum(investment_mmusd), 0)::numeric AS investment_mmusd
        FROM projects
        GROUP BY 1
        ORDER BY project_count DESC
      `),

      // --- 4. Construction start timeline ---
      run(`
        SELECT
          id, id_excel, name, company_name, sector, region, project_status,
          rca_status, investment_mmusd, construction_start_on,
          permit_count, pending_permit_count
        FROM projects
        WHERE construction_start_on IS NOT NULL
        ORDER BY construction_start_on
      `),

      // --- 5. "Monitor projects" banner ---
      run(`
        SELECT
          CASE
            WHEN construction_start_on < CURRENT_DATE + 90 THEN 'upcoming'
            ELSE 'later'
          END                                       AS bucket,
          count(*)::int                             AS project_count,
          COALESCE(sum(investment_mmusd), 0)::numeric AS investment_mmusd,
          COALESCE(sum(construction_jobs), 0)::int  AS construction_jobs,
          COALESCE(sum(operation_jobs), 0)::int     AS operation_jobs,
          json_agg(
            json_build_object(
              'id', id, 'idExcel', id_excel, 'name', name,
              'companyName', company_name, 'sector', sector, 'region', region,
              'investmentMmusd', investment_mmusd,
              'constructionStartOn', construction_start_on,
              'pendingPermitCount', pending_permit_count
            ) ORDER BY construction_start_on
          )                                         AS projects
        FROM projects
        WHERE project_status = 'No se ha iniciado'
          AND construction_start_on IS NOT NULL
          AND construction_start_on >= CURRENT_DATE
        GROUP BY 1
      `),

      // --- 8. Permits by agency ---
      run(`
        SELECT
          agency_name                                                    AS agency,
          agency_id,
          ministry_name                                                  AS ministry,
          count(*)::int                                                  AS total,
          count(*) FILTER (WHERE tracking_status = 'pending')::int        AS pending,
          count(*) FILTER (WHERE tracking_status = 'overdue')::int        AS overdue,
          count(*) FILTER (WHERE tracking_status = 'resolved')::int       AS resolved
        FROM permits
        GROUP BY 1, 2, 3
        ORDER BY total DESC
      `),

      // --- 9. Permits by region ---
      run(`
        SELECT
          COALESCE(region, 'Sin región')                                 AS region,
          count(*)::int                                                  AS total,
          count(*) FILTER (WHERE tracking_status = 'pending')::int        AS pending,
          count(*) FILTER (WHERE tracking_status = 'overdue')::int        AS overdue,
          count(*) FILTER (WHERE tracking_status = 'resolved')::int       AS resolved
        FROM permits
        GROUP BY 1
        ORDER BY total DESC
      `),

      // --- 10. Permit status donut ---
      run(`
        SELECT tracking_status AS status, count(*)::int AS permit_count
        FROM permits
        GROUP BY 1
      `),

      // --- 11. Critical permits ---
      //
      // Criticality is not just "overdue": an overdue permit blocking a
      // project whose construction starts soon matters more. Those come
      // first, then the longest overdue.
      run(`
        SELECT
          pm.id, pm.id_excel, pm.name, pm.agency_name AS agency,
          pm.project_id, pm.project_name, pm.company_name,
          pm.tracking_status, pm.overdue_days, pm.days_in_process,
          pm.expected_resolution_on, pm.investment_mmusd, pm.is_critical,
          pj.construction_start_on,
          CASE
            WHEN pj.construction_start_on IS NOT NULL
             AND pj.construction_start_on <= CURRENT_DATE + 90 THEN 'high'
            ELSE 'normal'
          END AS priority
        FROM permits pm
        JOIN projects pj ON pj.id = pm.project_id
        WHERE pm.tracking_status = 'overdue'
        ORDER BY
          CASE
            WHEN pj.construction_start_on IS NOT NULL
             AND pj.construction_start_on <= CURRENT_DATE + 90 THEN 0
            ELSE 1
          END,
          pm.overdue_days DESC NULLS LAST
        LIMIT 25
      `),
    ])

    const bucket = (name: 'upcoming' | 'later') => {
      const row = monitor.rows.find((r) => r.bucket === name)
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
      kpis: camelizeRow(kpis.rows[0]),
      projectsByRegion: camelizeRows(projectsByRegion.rows),
      projectsBySector: camelizeRows(projectsBySector.rows),
      rcaStatus: camelizeRows(rcaStatus.rows),
      timeline: camelizeRows(timeline.rows),
      monitor: { upcoming: bucket('upcoming'), later: bucket('later') },
      permitsByAgency: camelizeRows(permitsByAgency.rows),
      permitsByRegion: camelizeRows(permitsByRegion.rows),
      permitStatus: camelizeRows(permitStatus.rows),
      criticalPermits: camelizeRows(criticalPermits.rows),
    })
  } catch (err) {
    next(err)
  }
})

export default router
