import type { Pool } from 'pg'

// ----------------------------------------------------------------------------
// Committee tables — a replica of the "Tablas PPT Actualizada" sheet of the
// Excel "Levantamiento de Permisos C.M.E" (23-10-2026 version).
//
// These are the tables the team pastes into each committee presentation:
//   Summary    "N proyectos priorizados por proximidad a construir…" (B18)
//   Table 1    projects and permits per session (baseline + every session)
//   Table 1.1  projects whose permits in progress are ALL older than 6 months
//   Table 2.1  all projects by stage
//   Table 2.2  released projects by stage
//   Table 3    permit progress by ministry (previous vs current session)
//   Table 4    cumulative % progress by ministry, session by session
//
// Every calculation cites the Excel cell/formula it replicates. Everything
// is computed live from the database, so editing a permit in the app moves
// the tables too.
//
// Sheet vocabulary:
//   - "current committee" = the last session already held (column P /
//     "Comité 16" in the Excel). "previous session" = the one before (col O).
//   - Permits registered IN the current committee are left out of Tables 3
//     and 4 (filter `comite_registro <> "Comité N"`); they show up separately
//     as "Se añaden" (newly added).
//   - Project universe = `proyectos.en_universo_permisos`, loaded from the
//     Excel column AG "en_universo_2" (see db/cargar_excel.py).
//   - Permit universe in the formulas (Permisos[en_universo_2]) = its project
//     is in the universe, it is not "Descartado" and it was not resolved
//     before the baseline. The formulas also ask for a filing date where
//     relevant (fecha_ingreso <= session).
// ----------------------------------------------------------------------------

/**
 * Baseline date (column C of Table 1, "8 de mayo"). In the Excel it is a
 * fixed value, not a committee session, so it does not live in `comites`.
 */
export const BASELINE_DATE = '2026-05-08'

/**
 * Date the 2nd catastro batch joins the follow-up (Parámetros!C19,
 * "FechaIngresoCat2"). Before it, Table 1 only counts 1st-batch projects.
 */
export const SECOND_BATCH_DATE = '2026-10-15'

/**
 * Rows of Tables 3 and 4. The Excel matches by the ministry name PREFIX
 * (`TRIM($B52)&"*"`), which is why "Ministerio de las Culturas" is enough
 * for the long name.
 *
 * - `statutoryDays`: "Plazo normativo (días promedio ponderado)", a
 *   hand-typed number in the sheet; the last three ministries have none.
 * - `ranked`: the sheet sorts these rows by % progress (lowest first); the
 *   rest go after them in this fixed order.
 * - `noData`: the sheet writes "Sin información" instead of their progress.
 * - Non-ranked rows only show totals and "Se añaden" in Table 3 (the
 *   resolved columns are empty), but Table 4 does compute their % (except
 *   the `noData` ones).
 */
export const TABLE_MINISTRIES: readonly {
  label: string
  statutoryDays: number | null
  ranked?: boolean
  noData?: boolean
}[] = [
  { label: 'Ministerio de Bienes Nacionales', statutoryDays: 128, ranked: true },
  { label: 'Ministerio de Minería', statutoryDays: 50, ranked: true },
  { label: 'Ministerio de Obras Públicas', statutoryDays: 177, ranked: true },
  { label: 'Ministerio de Energía', statutoryDays: 170, ranked: true },
  { label: 'Ministerio de Salud', statutoryDays: 30, ranked: true },
  { label: 'Ministerio de las Culturas', statutoryDays: 68, ranked: true },
  { label: 'Ministerio de Vivienda y Urbanismo', statutoryDays: 45, ranked: true },
  { label: 'Ministerio de Agricultura', statutoryDays: 53, ranked: true },
  { label: 'Ministerio de Defensa Nacional', statutoryDays: 180, noData: true },
  { label: 'Municipalidades', statutoryDays: 30, noData: true },
  { label: 'Ministerio de Medio Ambiente', statutoryDays: null },
  { label: 'Ministerio de Transportes y Telecomunicaciones', statutoryDays: null },
  { label: 'Ministerio de Desarrollo Social y Familia', statutoryDays: null },
]

/** Table 2 stages, in the sheet's order (they match `etapas_proyecto`). */
const STAGES = ['No se ha iniciado', 'En fase de construcción', 'En operación'] as const

// ----------------------------------------------------------------------------
// Raw rows from the database
// ----------------------------------------------------------------------------

interface Session {
  number: number
  date: string // YYYY-MM-DD
}

interface PermitRow {
  project_id: number
  ministry: string | null
  status: string | null
  filed_date: string | null
  resolution_date: string | null
  /** Permisos[en_universo_2] of the formulas (see the header). */
  in_universe: boolean
  /** Excel column Permisos[supera_6_meses], recomputed as of today (see the query). */
  over_6_months: boolean
  /** Registered in the current committee (`comite_registro = "Comité N"`). */
  in_current_committee: boolean
}

interface ProjectRow {
  id: number
  batch: number // n_catastro: 1 or 2
  stage: string | null
  investment_mmusd: number
  construction_jobs: number
  /** Excel column "Urgencia" (priority), e.g. "Próximos a iniciar construcción 1". */
  urgency: string | null
  /** null = no data; only `false` ("No") takes it out of the released ones. */
  still_released_on_contact: boolean | null
}

// ----------------------------------------------------------------------------
// Result
// ----------------------------------------------------------------------------

export interface PriorityGroup {
  projects: number
  investmentMmusd: number
  pendingPermits: number
}

export interface Table1Column {
  label: string // "Línea Base" | "Sesión 4" ...
  date: string
  totalProjects: number
  projectsInProgress: number
  releasedProjects: number
  totalPermits: number
  permitsInProgress: number
  resolvedPermits: number
  /** null at the baseline (the sheet shows "-"). */
  newPermits: number | null
}

export interface StageRow {
  stage: string
  projects: number
  constructionJobs: number
  investmentMmusd: number
}

export interface Table3Row {
  ministry: string
  /** "Totales al Comité N-1". */
  totalAtPrevious: number
  /** "Pendientes al Comité N-1"; null = empty ("Sin información" for noData). */
  pendingAtPrevious: number | null
  /** "Resueltos al Comité N-1"; null = empty. */
  resolvedAtPrevious: number | null
  /** "Resueltos entre Comité N-1 y N"; null = empty. */
  resolvedBetween: number | null
  /** "Resueltos totales" up to the current session; null = empty. */
  resolvedTotal: number | null
  progress: number | null
  /** "Se añaden (Comité N)". */
  added: number
  statutoryDays: number | null
  noData: boolean
}

export interface Table4Row {
  ministry: string
  total: number
  /** Cumulative % per session, aligned with `sessions`; null = empty. */
  progressBySession: (number | null)[]
  added: number
  noData: boolean
}

export interface CommitteeTables {
  /** Today's date, used for the "+6 months" figures (the sheet uses TODAY()). */
  computedOn: string
  baselineDate: string
  secondBatchDate: string
  currentSession: Session
  previousSession: Session | null
  sessions: Session[]
  /** B18: priority projects ("Urgencia") in the universe. */
  summary: { nearConstruction: PriorityGroup; investmentOrJobs: PriorityGroup }
  table1: Table1Column[]
  table11: { projects: number; investmentMmusd: number; constructionJobs: number }
  table21: { rows: StageRow[]; total: StageRow }
  table22: { rows: StageRow[]; total: StageRow }
  table3: { rows: Table3Row[]; total: Table3Row }
  table4: {
    rows: Table4Row[]
    total: Table4Row
    /** "Avance en puntos porcentuales": total % minus the previous session's; null for the first. */
    pointsGained: (number | null)[]
  }
  /** Universe permits from ministries the sheet does not list (left out of Tables 3 and 4). */
  permitsOutsideListedMinistries: number
}

// ----------------------------------------------------------------------------
// Calculation
// ----------------------------------------------------------------------------

export async function fetchCommitteeTables(pool: Pool): Promise<CommitteeTables | null> {
  // Sessions already held. The last one is the "current committee".
  const { rows: sessions } = await pool.query<Session & { id: number }>(
    `SELECT id::int AS id, numero AS number, fecha::text AS date
       FROM comites
      WHERE fecha <= current_date
      ORDER BY fecha`,
  )
  if (sessions.length === 0) return null
  const current = sessions[sessions.length - 1]
  const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null

  const { rows: [dates] } = await pool.query<{ today: string }>(`SELECT current_date::text AS today`)

  const { rows: permits } = await pool.query<PermitRow>(
    `SELECT p.proyecto_id::int AS project_id,
            m.nombre AS ministry,
            e.nombre AS status,
            p.fecha_ingreso::text AS filed_date,
            p.fecha_resolucion::text AS resolution_date,
            -- Permisos[en_universo_2]: project in the universe (column AG),
            -- not discarded and not resolved before the baseline.
            (pr.en_universo_permisos IS TRUE
              AND e.nombre IS DISTINCT FROM 'Descartado'
              AND NOT COALESCE(p.fecha_resolucion < $1::date, false)) AS in_universe,
            -- Excel Permisos[supera_6_meses]: resolved -> took more than 6
            -- months; resolved/discarded without a date -> unknown (false);
            -- pending -> has been open for more than 6 months as of today.
            CASE
              WHEN p.fecha_ingreso IS NULL THEN false
              WHEN p.fecha_resolucion IS NOT NULL
                THEN p.fecha_ingreso + interval '6 months' < p.fecha_resolucion
              WHEN e.nombre IN ('Resuelto', 'Descartado') THEN false
              ELSE p.fecha_ingreso + interval '6 months' < current_date
            END AS over_6_months,
            EXISTS (
              SELECT 1 FROM permisos_comite pc
               WHERE pc.permiso_id = p.id AND pc.comite_id = $2
            ) AS in_current_committee
       FROM permisos p
       JOIN proyectos pr ON pr.id = p.proyecto_id
       LEFT JOIN estados_permiso e ON e.id = p.estado_id
       LEFT JOIN organismos o ON o.id = p.organismo_id
       LEFT JOIN ministerios m ON m.id = o.ministerio_id`,
    [BASELINE_DATE, current.id],
  )

  // Only projects in the universe: EVERY project table in the sheet filters on it.
  const { rows: projects } = await pool.query<ProjectRow>(
    `SELECT pr.id::int AS id,
            pr.n_catastro AS batch,
            et.nombre AS stage,
            COALESCE(pr.inversion_mmusd, 0)::float8 AS investment_mmusd,
            COALESCE(pr.empleo_construccion, 0)::int AS construction_jobs,
            pr.urgencia AS urgency,
            pr.sigue_liberado_al_contactar AS still_released_on_contact
       FROM proyectos pr
       LEFT JOIN etapas_proyecto et ON et.id = pr.etapa_id
      WHERE pr.en_universo_permisos IS TRUE`,
  )

  const permitsByProject = new Map<number, PermitRow[]>()
  for (const p of permits) {
    const list = permitsByProject.get(p.project_id) ?? []
    list.push(p)
    permitsByProject.set(p.project_id, list)
  }

  // --- Derived columns of the "Proyectos" sheet ------------------------------

  /** Proyectos[proyecto_sin_permisos_pendientes_bbdd] = "Sí". */
  const hasNoPending = (pr: ProjectRow) =>
    !(permitsByProject.get(pr.id) ?? []).some((p) => p.status === 'Pendiente')

  /**
   * Proyectos[fecha_ultima_resolucion]: the latest resolution among its
   * permits, only when none is pending anymore. null = empty.
   */
  const lastResolutionDate = (pr: ProjectRow): string | null => {
    if (!hasNoPending(pr)) return null
    const resolved = (permitsByProject.get(pr.id) ?? [])
      .map((p) => p.resolution_date)
      .filter((d): d is string => d !== null)
    return resolved.length ? resolved.sort().at(-1)! : null
  }

  /** Released (no date): nothing pending and not marked "No" on contact. Table 2.2. */
  const isReleased = (pr: ProjectRow) =>
    hasNoPending(pr) && pr.still_released_on_contact !== false

  /**
   * Released as of a date (Table 1, "Liberados" row, C12): same as above, but
   * its last resolution must be <= that date (or have no date).
   */
  const releasedAsOf = (pr: ProjectRow, date: string) => {
    if (!isReleased(pr)) return false
    const last = lastResolutionDate(pr)
    return last === null || last <= date
  }

  /**
   * Proyectos[cien_pct_mas_6m_en_tramite]: it has permits in progress today
   * and ALL of them are older than 6 months. "In progress" = filed by today
   * minus resolved by today (the sheet subtracts counts; same here).
   */
  const allInProgressOver6m = (pr: ProjectRow) => {
    const today = dates.today
    const ps = permitsByProject.get(pr.id) ?? []
    const filed = (onlyOld: boolean) =>
      ps.filter((p) => p.filed_date && p.filed_date <= today && (!onlyOld || p.over_6_months)).length
    const resolved = (onlyOld: boolean) =>
      ps.filter((p) => p.resolution_date && p.resolution_date <= today && (!onlyOld || p.over_6_months)).length
    const inProgress = filed(false) - resolved(false)
    return inProgress > 0 && filed(true) - resolved(true) === inProgress
  }

  const universe = permits.filter((p) => p.in_universe)

  // --- Summary sentence (G18) ----------------------------------------------

  const priorityGroup = (matches: (urgency: string) => boolean): PriorityGroup => {
    const list = projects.filter((pr) => pr.urgency !== null && matches(pr.urgency))
    const ids = new Set(list.map((pr) => pr.id))
    return {
      projects: list.length,
      investmentMmusd: sum(list, (pr) => pr.investment_mmusd),
      // Universe permits still "Pendiente" whose project has that priority.
      pendingPermits: universe.filter((p) => p.status === 'Pendiente' && ids.has(p.project_id)).length,
    }
  }
  const summary = {
    // Urgencia = "Próximos a iniciar construcción*"
    nearConstruction: priorityGroup((u) => u.startsWith('Próximos a iniciar construcción')),
    // Urgencia = "Inversión*" or exactly "Empleo"
    investmentOrJobs: priorityGroup((u) => u.startsWith('Inversión') || u === 'Empleo'),
  }

  // --- Table 1 -------------------------------------------------------------

  /** C10: 1st-batch projects, plus the 2nd batch from the date it joined. */
  const projectsAsOf = (date: string) =>
    projects.filter((pr) => pr.batch === 1 || (pr.batch === 2 && date >= SECOND_BATCH_DATE))

  const columns = [
    { label: 'Línea Base', date: BASELINE_DATE },
    ...sessions.map((s) => ({ label: `Sesión ${s.number}`, date: s.date })),
  ]
  const table1: Table1Column[] = columns.map((col, i) => {
    const inScope = projectsAsOf(col.date)
    const released = inScope.filter((pr) => releasedAsOf(pr, col.date)).length // C12
    // C13: universe permits filed by that date.
    const filed = universe.filter((p) => p.filed_date && p.filed_date <= col.date)
    // C15: of those, resolved by that date.
    const resolved = filed.filter((p) => p.resolution_date && p.resolution_date <= col.date).length
    // D16: filed between the previous column (exclusive) and this one (inclusive).
    const prevDate = i > 0 ? columns[i - 1].date : null
    const added =
      prevDate === null
        ? null
        : universe.filter((p) => p.filed_date && p.filed_date > prevDate && p.filed_date <= col.date).length
    return {
      label: col.label,
      date: col.date,
      totalProjects: inScope.length,
      projectsInProgress: inScope.length - released, // C11
      releasedProjects: released,
      totalPermits: filed.length,
      permitsInProgress: filed.length - resolved, // C14
      resolvedPermits: resolved,
      newPermits: added,
    }
  })

  // --- Table 1.1 (C23:C25) -------------------------------------------------

  const allOld = projects.filter(allInProgressOver6m)
  const table11 = {
    projects: allOld.length,
    investmentMmusd: sum(allOld, (pr) => pr.investment_mmusd),
    constructionJobs: sum(allOld, (pr) => pr.construction_jobs),
  }

  // --- Tables 2.1 and 2.2 (C32:E35, C41:E44) -------------------------------

  const byStage = (list: ProjectRow[]) => {
    const rows = STAGES.map((stage) => stageSummary(stage, list.filter((pr) => pr.stage === stage)))
    // The sheet's total is the SUM of the 3 rows (not a separate count), so
    // a project without a stage does not add to the total. Same here.
    const total: StageRow = {
      stage: 'Total',
      projects: sum(rows, (r) => r.projects),
      constructionJobs: sum(rows, (r) => r.constructionJobs),
      investmentMmusd: sum(rows, (r) => r.investmentMmusd),
    }
    return { rows, total }
  }
  const table21 = byStage(projects)
  const table22 = byStage(projects.filter(isReleased))

  // --- Table 3 (C52:J65) ---------------------------------------------------
  //
  // Table base: universe permits filed up to the PREVIOUS session that were
  // not registered in the current committee.

  const datePrev = previous?.date ?? current.date // $O$7
  const dateCurr = current.date // $P$7
  const tableBase = universe.filter(
    (p) => p.filed_date && p.filed_date <= datePrev && !p.in_current_committee,
  )
  const ofMinistry = (list: PermitRow[], label: string) =>
    list.filter((p) => p.ministry?.startsWith(label))
  const resolvedBy = (list: PermitRow[], date: string) =>
    list.filter((p) => p.resolution_date && p.resolution_date <= date).length

  /** I52 / Q74: universe permits registered IN the current committee. */
  const addedNow = universe.filter(
    (p) => p.in_current_committee && p.filed_date && p.filed_date <= dateCurr,
  )

  const unsorted3: Table3Row[] = TABLE_MINISTRIES.map((m) => {
    const ps = ofMinistry(tableBase, m.label)
    const total = ps.length // C52
    const added = ofMinistry(addedNow, m.label).length // I52
    if (!m.ranked) {
      // Only total and "Se añaden" in the sheet; the resolved columns are empty.
      return {
        ministry: m.label, totalAtPrevious: total, pendingAtPrevious: null, resolvedAtPrevious: null,
        resolvedBetween: null, resolvedTotal: null, progress: null, added,
        statutoryDays: m.statutoryDays, noData: !!m.noData,
      }
    }
    const resolvedAtPrevious = resolvedBy(ps, datePrev)
    const resolvedTotal = resolvedBy(ps, dateCurr) // G52
    return {
      ministry: m.label,
      totalAtPrevious: total,
      pendingAtPrevious: total - resolvedAtPrevious, // D52
      resolvedAtPrevious, // E52 = C52 - D52
      // F52: status Resuelto, resolved between the previous and current session.
      resolvedBetween: ps.filter(
        (p) => p.status === 'Resuelto' && p.resolution_date && p.resolution_date > datePrev && p.resolution_date <= dateCurr,
      ).length,
      resolvedTotal,
      progress: ratio(resolvedTotal, total), // H52
      added,
      statutoryDays: m.statutoryDays, // J52 (fixed)
      noData: false,
    }
  })
  // The sheet lists the ranked ministries from lowest to highest progress.
  const rows3 = [
    ...unsorted3.filter((r) => r.progress !== null).sort((a, b) => a.progress! - b.progress!),
    ...unsorted3.filter((r) => r.progress === null),
  ]
  const order = rows3.map((r) => r.ministry)

  // Row 65: plain SUMs (an empty cell counts as 0); progress = G65 / C65.
  const total3 = sum(rows3, (r) => r.totalAtPrevious)
  const resolved3 = sum(rows3, (r) => r.resolvedTotal ?? 0)
  const totalRow3: Table3Row = {
    ministry: 'Total',
    totalAtPrevious: total3,
    pendingAtPrevious: sum(rows3, (r) => r.pendingAtPrevious ?? 0),
    resolvedAtPrevious: sum(rows3, (r) => r.resolvedAtPrevious ?? 0),
    resolvedBetween: sum(rows3, (r) => r.resolvedBetween ?? 0),
    resolvedTotal: resolved3,
    progress: ratio(resolved3, total3),
    added: sum(rows3, (r) => r.added),
    statutoryDays: null, // the sheet leaves it empty
    noData: false,
  }

  // --- Table 4 (C74:Q88) ---------------------------------------------------

  /** D74: status Resuelto with resolution <= the session date, over Table 3's base. */
  const resolvedStatusBy = (list: PermitRow[], date: string) =>
    list.filter((p) => p.status === 'Resuelto' && p.resolution_date && p.resolution_date <= date).length

  const rows4: Table4Row[] = order.map((label) => {
    const m = TABLE_MINISTRIES.find((x) => x.label === label)!
    const ps = ofMinistry(tableBase, label)
    return {
      ministry: label,
      total: ps.length, // C74
      // IFERROR(.../0, "") -> a ministry with no permits shows empty, not 0%.
      progressBySession: sessions.map((s) =>
        m.noData || ps.length === 0 ? null : resolvedStatusBy(ps, s.date) / ps.length,
      ),
      added: ofMinistry(addedNow, label).length, // Q74
      noData: !!m.noData,
    }
  })
  // Total row (D87): NOTE the sheet's numerator does NOT filter by ministry
  // (it counts resolved permits from all of them, including unlisted ones),
  // but the denominator is the sum of the listed rows. Replicated as is.
  const total4 = sum(rows4, (r) => r.total)
  const totalRow4: Table4Row = {
    ministry: 'Total',
    total: total4,
    progressBySession: sessions.map((s) => ratio(resolvedStatusBy(tableBase, s.date), total4)),
    added: sum(rows4, (r) => r.added),
    noData: false,
  }
  // Row 88, "Avance en puntos porcentuales": (E87 - D87) * 100.
  const pointsGained = totalRow4.progressBySession.map((p, i) =>
    i === 0 || p === null ? null : (p - (totalRow4.progressBySession[i - 1] ?? 0)) * 100,
  )

  const permitsOutsideListedMinistries = tableBase.filter(
    (p) => !TABLE_MINISTRIES.some((m) => p.ministry?.startsWith(m.label)),
  ).length

  const toSession = (s: Session): Session => ({ number: s.number, date: s.date })
  return {
    computedOn: dates.today,
    baselineDate: BASELINE_DATE,
    secondBatchDate: SECOND_BATCH_DATE,
    currentSession: toSession(current),
    previousSession: previous && toSession(previous),
    sessions: sessions.map(toSession),
    summary,
    table1,
    table11,
    table21,
    table22,
    table3: { rows: rows3, total: totalRow3 },
    table4: { rows: rows4, total: totalRow4, pointsGained },
    permitsOutsideListedMinistries,
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function sum<T>(list: readonly T[], value: (x: T) => number): number {
  return list.reduce((acc, x) => acc + value(x), 0)
}

/** The sheet's IFERROR(a/b, 0). */
function ratio(a: number, b: number): number {
  return b === 0 ? 0 : a / b
}

function stageSummary(stage: string, list: ProjectRow[]): StageRow {
  return {
    stage,
    projects: list.length,
    constructionJobs: sum(list, (pr) => pr.construction_jobs),
    investmentMmusd: sum(list, (pr) => pr.investment_mmusd),
  }
}
