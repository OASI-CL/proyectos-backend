import type { Pool, PoolClient } from 'pg'
import {
  SqlParams,
  PERMIT_TRACKING_STATUS_SQL,
  OVERDUE_DAYS_SQL,
  rcaStatusSql,
} from '../db/sql'
import type { UsuarioAutenticado } from '../middleware/auth'

// ----------------------------------------------------------------------------
// Global filters
//
// The whole dashboard is driven by a single filter set (see README_dashboard
// section 12): every section recomputes against the same filtered universe.
// ----------------------------------------------------------------------------

export interface DashboardFilters {
  ministryId?: number
  agencyId?: number
  sector?: string
  region?: string
  projectStatus?: string
  permitStatus?: string
  companyId?: number
  projectId?: number
  rcaStatus?: string
  /** ISO date (YYYY-MM-DD). Filters on proyectos.fecha_inicio_construccion. */
  startDateFrom?: string
  startDateTo?: string
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
export function buildScope(user: UsuarioAutenticado, filters: DashboardFilters) {
  const sql = new SqlParams()
  const permitWhere: string[] = []
  const projectWhere: string[] = []

  // --- Role scoping: never trust the frontend to filter (see scope.ts) ---
  if (user.rol === 'empresa') {
    permitWhere.push(`p.empresa_id = ${sql.add(user.empresaId ?? -1)}`)
    projectWhere.push(`pr.empresa_id = ${sql.add(user.empresaId ?? -1)}`)
  } else if (user.rol === 'organismo') {
    const agency = sql.add(user.organismoId ?? -1)
    permitWhere.push(`p.organismo_id = ${agency}`)
    projectWhere.push(`pr.id IN (SELECT proyecto_id FROM permisos WHERE organismo_id = ${agency})`)
  } else if (user.rol === 'region') {
    // Sees every project of its region, across all agencies. Scoped by
    // region_id (indexed integer) rather than by the region name.
    const region = sql.add(user.regionId ?? -1)
    permitWhere.push(`p.region_id = ${region}`)
    projectWhere.push(`pr.region_id = ${region}`)
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
  // Project start date range (fecha_inicio_construccion). Projects with no
  // start date at all are excluded once either end of the range is set.
  if (filters.startDateFrom !== undefined) {
    const value = sql.add(filters.startDateFrom)
    projectWhere.push(`pr.fecha_inicio_construccion >= ${value}`)
    permitWhere.push(
      `p.proyecto_id IN (SELECT id FROM proyectos WHERE fecha_inicio_construccion >= ${value})`,
    )
  }
  if (filters.startDateTo !== undefined) {
    const value = sql.add(filters.startDateTo)
    projectWhere.push(`pr.fecha_inicio_construccion <= ${value}`)
    permitWhere.push(
      `p.proyecto_id IN (SELECT id FROM proyectos WHERE fecha_inicio_construccion <= ${value})`,
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
        p.region_id,
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
        pr.region_id,
        pr.region,
        pr.sector,
        pr.etapa                        AS project_status,
        -- Stable key of the stage. Section 5 below matches on this instead of
        -- on the display name, which is free to be reworded in the catalog.
        pr.etapa_codigo                 AS project_status_code,
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

export interface DashboardData {
  kpis: Record<string, unknown>
  projectsByRegion: Record<string, unknown>[]
  projectsBySector: Record<string, unknown>[]
  rcaStatus: Record<string, unknown>[]
  timeline: Record<string, unknown>[]
  mapProjects: Record<string, unknown>[]
  monitor: Record<string, unknown>[]
  permitsByAgency: Record<string, unknown>[]
  permitsByRegion: Record<string, unknown>[]
  permitStatus: Record<string, unknown>[]
  criticalPermits: Record<string, unknown>[]
}

/** Runs every dashboard section query against the shared filtered universe. */
export async function fetchDashboard(
  db: Pool | PoolClient,
  user: UsuarioAutenticado,
  filters: DashboardFilters,
): Promise<DashboardData> {
  const { cte, params } = buildScope(user, filters)
  const run = (select: string) => db.query(`${cte} ${select}`, params)

  const [
    kpis,
    projectsByRegion,
    projectsBySector,
    rcaStatus,
    timeline,
    mapProjects,
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

    // --- Map: one row per project. Only region is known (no coordinates);
    // the frontend places each dot inside its region. ---
    run(`
      SELECT id, id_excel, name, company_name, sector, region, project_status, investment_mmusd
      FROM projects
      ORDER BY investment_mmusd DESC NULLS LAST
    `),

    // --- 5. "Monitor projects" banner ---
    //
    // Two independent lenses on projects that have not started construction
    // yet, not a single mutually-exclusive split — a project can appear in
    // both cards.
    //   upcoming     — construction starts within the next 90 days
    //   few_permits  — 1 or 2 pending permits left (close to fully cleared)
    run(`
      SELECT
        'upcoming'                                 AS bucket,
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
      WHERE project_status_code = 'no_iniciado'
        AND construction_start_on IS NOT NULL
        AND construction_start_on >= CURRENT_DATE
        AND construction_start_on < CURRENT_DATE + 90

      UNION ALL

      SELECT
        'few_permits'                              AS bucket,
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
          ) ORDER BY pending_permit_count, name
        )                                         AS projects
      FROM projects
      WHERE project_status_code = 'no_iniciado'
        AND pending_permit_count > 0
        AND pending_permit_count < 3
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

  return {
    kpis: kpis.rows[0],
    projectsByRegion: projectsByRegion.rows,
    projectsBySector: projectsBySector.rows,
    rcaStatus: rcaStatus.rows,
    timeline: timeline.rows,
    mapProjects: mapProjects.rows,
    monitor: monitor.rows,
    permitsByAgency: permitsByAgency.rows,
    permitsByRegion: permitsByRegion.rows,
    permitStatus: permitStatus.rows,
    criticalPermits: criticalPermits.rows,
  }
}
