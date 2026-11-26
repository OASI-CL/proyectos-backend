import type { Pool } from 'pg'

// ----------------------------------------------------------------------------
// Committee tables — a replica of the "Tablas CME" sheet of the Excel
// "Levantamiento de Permisos C.M.E" (26-11-2026 version; until then the sheet
// was called "Tablas PPT Actualizada").
//
// These are the tables the team pastes into each committee presentation:
//   Summary    "N proyectos priorizados por proximidad a construir…" (B19)
//   Table 1    projects and permits per session (baseline + every session)
//   Table 2.1  all projects by stage
//   Table 2.2  released projects by stage
//   Table 3    permit progress by ministry (previous vs current session)
//   Table 4    cumulative % progress by ministry, session by session
//   Urgency    priority permits resolved by agency, by "Urgencia" (B87)
//   Table 3.1  Table 3, by agency
//   Table 4.1  Table 4, by agency
// (The old Table 1.1 "100% de sus trámites con más de 6 meses" is no longer
// in the sheet.)
//
// Every calculation cites the Excel cell/formula it replicates. Everything
// is computed live from the database, so editing a permit in the app moves
// the tables too.
//
// Sheet vocabulary:
//   - "current committee" = the LAST session of the calendar (column S /
//     "Comité 19" in the Excel, the one the deck is being prepared for; the
//     sheet uses MAX(tblSesiones[Fecha]) for it). "previous session" = the
//     one before (column R).
//   - Permits registered IN the current committee are left out of Tables 3,
//     4, 3.1 and 4.1 (filter `comite_registro <> "Comité N"`); they show up
//     separately as "Se añaden" (newly added).
//   - Project universe = `proyectos.en_universo_permisos`, loaded from the
//     Excel column AG "en_universo_2" (see db/cargar_excel.py).
//   - Permit universe in the formulas (Permisos[en_universo_2]) = its project
//     is in the universe, it is not "Descartado" and it was not resolved
//     before the baseline. The formulas also ask for a filing date where
//     relevant (fecha_ingreso <= session).
//   - Columns factibilidad / estado_liberacion / comite_ingreso /
//     etapa_liberados come straight from the Proyectos sheet (migration 0014).
// ----------------------------------------------------------------------------

/**
 * Baseline date (column C of Table 1, "8 de mayo"). In the Excel it is a
 * fixed value, not a committee session, so it does not live in `comites`.
 */
export const BASELINE_DATE = '2026-05-08'

/**
 * Dates each catastro batch joins the follow-up: FechaIngresoCat2 =
 * Parámetros!C19 (session 15) and FechaIngresoCat3 = Parámetros!C22
 * (session 18). Before them, Table 1 does not count that batch.
 */
export const SECOND_BATCH_DATE = '2026-10-15'
export const THIRD_BATCH_DATE = '2026-11-26'

/**
 * Rows of Tables 3 and 4, in the sheet's order (it is a fixed order now, not
 * sorted by progress). The Excel matches by the ministry name PREFIX
 * (`TRIM($B48)&"*"`), which is why "Ministerio de las Culturas" is enough
 * for the long name.
 *
 * - `statutoryDays`: "Plazo normativo (días promedio ponderado)", a
 *   hand-typed number in the sheet; the last three ministries have none.
 * - `full`: Table 3 fills every column; the rest only show totals and
 *   "Se añaden" (the resolved columns are empty). Table 4 still computes the
 *   % of the non-full ones, except the `noData` ones.
 * - `noData`: the sheet writes "Sin información" instead of their progress.
 */
export const TABLE_MINISTRIES: readonly {
  label: string
  statutoryDays: number | null
  full?: boolean
  noData?: boolean
}[] = [
  { label: 'Ministerio de Defensa Nacional', statutoryDays: 180, full: true },
  { label: 'Ministerio de Bienes Nacionales', statutoryDays: 128, full: true },
  { label: 'Ministerio de Energía', statutoryDays: 170, full: true },
  { label: 'Ministerio de Obras Públicas', statutoryDays: 177, full: true },
  { label: 'Ministerio de Minería', statutoryDays: 50, full: true },
  { label: 'Ministerio de Salud', statutoryDays: 30, full: true },
  { label: 'Ministerio de las Culturas', statutoryDays: 68, full: true },
  { label: 'Ministerio de Vivienda y Urbanismo', statutoryDays: 45, full: true },
  { label: 'Ministerio de Agricultura', statutoryDays: 53, full: true },
  { label: 'Municipalidades', statutoryDays: 30, noData: true },
  { label: 'Ministerio de Medio Ambiente', statutoryDays: null },
  { label: 'Ministerio de Transportes y Telecomunicaciones', statutoryDays: null },
  { label: 'Ministerio de Desarrollo Social y Familia', statutoryDays: null },
]

/*
 * Agencies of the by-agency tables, each in the sheet's own (fixed) order.
 * Names are the catalog's (`organismos.nombre`); the sheet writes two of them
 * differently: "Empresa de los Ferrocarriles del Estado (EFE)" = EFE and
 * "GORE" = GORE BIOBÍO (same aliases as db/seed_catalogos.py). The sheet
 * matches the agency exactly, so agencies it does not list (MMA, CNE,
 * SEREMI VIVIENDA) are left out of these tables.
 */

/** "Permisos priorizados resueltos por servicio, según urgencia" (rows 91-115). */
const URGENCY_AGENCIES = [
  'CONAF', 'CEN', 'MINVU', 'SAG', 'CMN', 'VIALIDAD', 'SEREMI SALUD', 'SERNAGEOMIN', 'DGA', 'SEC',
  'BBNN', 'SERVIU', 'DOM', 'GORE BIOBÍO', 'DGAC', 'SSFFAA', 'MDS', 'TGR', 'SEA', 'SMA',
  'DIRECCION GENERAL DE CONCESIONES', 'DOH', 'DIRECCIÓN DE TRANSITO', 'EFE', 'MTT',
] as const

/** Table 3.1 (rows 124-148). */
const TABLE31_AGENCIES = [
  'DOH', 'DIRECCION GENERAL DE CONCESIONES', 'SSFFAA', 'DGAC', 'MTT', 'DIRECCIÓN DE TRANSITO', 'EFE',
  'SEA', 'SMA', 'MDS', 'TGR', 'GORE BIOBÍO', 'DOM', 'BBNN', 'SEC', 'SERNAGEOMIN', 'DGA', 'SERVIU',
  'SEREMI SALUD', 'VIALIDAD', 'CMN', 'SAG', 'CEN', 'CONAF', 'MINVU',
] as const

/** Table 4.1 (rows 156-180): grouped by ministry. */
const TABLE41_AGENCIES = [
  'BBNN', 'SERNAGEOMIN', 'DGA', 'VIALIDAD', 'DOH', 'DIRECCION GENERAL DE CONCESIONES', 'SEC', 'CEN',
  'SEREMI SALUD', 'CMN', 'MINVU', 'SERVIU', 'CONAF', 'SAG', 'SSFFAA', 'DGAC', 'DOM', 'MTT',
  'DIRECCIÓN DE TRANSITO', 'EFE', 'SEA', 'SMA', 'MDS', 'TGR', 'GORE BIOBÍO',
] as const

/** Table 2 stages, in the sheet's order (they match `etapas_proyecto`). */
const STAGES = ['No se ha iniciado', 'En fase de construcción', 'En operación'] as const

/** "Urgencia" groups (B88): "Próximos a iniciar construcción 1/2" vs "Inversión*" / "Empleo". */
const isNearConstruction = (urgency: string | null) =>
  urgency !== null && urgency.startsWith('Próximos a iniciar construcción')
const isInvestmentOrJobs = (urgency: string | null) =>
  urgency !== null && (urgency.startsWith('Inversión') || urgency === 'Empleo')

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
  agency: string | null
  status: string | null
  filed_date: string | null
  resolution_date: string | null
  /** Permisos[en_universo_2] of the formulas (see the header). */
  in_universe: boolean
  /** Registered in the current committee (`comite_registro = "Comité N"`). */
  in_current_committee: boolean
  /** Permisos[Urgencia]: the project's "Urgencia". */
  urgency: string | null
}

interface ProjectRow {
  id: number
  batch: number | null // n_catastro: 1, 2 or 3
  in_universe: boolean // en_universo_2
  stage: string | null // etapa_proyecto
  released_stage: string | null // etapa_liberados
  investment_mmusd: number
  construction_jobs: number
  /** Excel column "Urgencia" (priority), e.g. "Próximos a iniciar construcción 1". */
  urgency: string | null
  /** null = no data; only `false` ("No") counts as "No" in the formulas. */
  still_released_on_contact: boolean | null
  /** Column "Factibilidad". */
  feasibility: string | null
  /** Column "Estado (Liberado, en curso, Desistido)". */
  release_status: string | null
  /** Column "comite_ingreso" (2nd batch). */
  joined_session: number | null
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
  withdrawnProjects: number
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

/** Table 3.1 row: same columns as Table 3, for one agency. */
export interface Table31Row {
  ministry: string
  agency: string
  totalAtPrevious: number
  pendingAtPrevious: number
  resolvedAtPrevious: number
  resolvedBetween: number
  resolvedTotal: number
  progress: number
  added: number
}

/** Table 4.1 row: same columns as Table 4, for one agency. */
export interface Table41Row {
  ministry: string
  agency: string
  total: number
  progressBySession: (number | null)[]
  added: number
}

/** One "Urgencia" group of the urgency table. */
export interface UrgencyCounts {
  total: number
  /** "Resueltos (#)": status Resuelto, any date. */
  resolved: number
  /** "Resueltos entre N-1 y N". */
  resolvedBetween: number
  /** "Resueltos (%)"; null = the sheet's "-" (no permits). */
  resolvedShare: number | null
}

export interface UrgencyRow {
  ministry: string
  agency: string
  nearConstruction: UrgencyCounts
  investmentOrJobs: UrgencyCounts
  total: UrgencyCounts
}

export interface CommitteeTables {
  computedOn: string
  baselineDate: string
  secondBatchDate: string
  thirdBatchDate: string
  currentSession: Session
  previousSession: Session | null
  sessions: Session[]
  /** B19: priority projects ("Urgencia") in the universe. */
  summary: { nearConstruction: PriorityGroup; investmentOrJobs: PriorityGroup }
  table1: Table1Column[]
  table21: { rows: StageRow[]; total: StageRow }
  table22: { rows: StageRow[]; total: StageRow }
  table3: { rows: Table3Row[]; total: Table3Row }
  table4: {
    rows: Table4Row[]
    total: Table4Row
    /** "Avance en puntos porcentuales": total % minus the previous session's; null for the first. */
    pointsGained: (number | null)[]
  }
  urgency: { rows: UrgencyRow[]; total: UrgencyRow }
  table31: { rows: Table31Row[]; total: Table31Row }
  table41: { rows: Table41Row[]; total: Table41Row; pointsGained: (number | null)[] }
  /** Universe permits from ministries the sheet does not list (left out of Tables 3 and 4). */
  permitsOutsideListedMinistries: number
}

// ----------------------------------------------------------------------------
// Calculation
// ----------------------------------------------------------------------------

export async function fetchCommitteeTables(pool: Pool): Promise<CommitteeTables | null> {
  // The whole calendar (Parámetros "Calendario de Sesiones"). The LAST
  // session is the "current committee" (see the header).
  const { rows: sessions } = await pool.query<Session & { id: number }>(
    `SELECT id::int AS id, numero AS number, fecha::text AS date
       FROM comites
      ORDER BY fecha`,
  )
  if (sessions.length === 0) return null
  const current = sessions[sessions.length - 1]
  const previous = sessions.length > 1 ? sessions[sessions.length - 2] : null

  const { rows: [dates] } = await pool.query<{ today: string }>(`SELECT current_date::text AS today`)

  const { rows: permits } = await pool.query<PermitRow>(
    `SELECT p.proyecto_id::int AS project_id,
            m.nombre AS ministry,
            o.nombre AS agency,
            e.nombre AS status,
            p.fecha_ingreso::text AS filed_date,
            p.fecha_resolucion::text AS resolution_date,
            -- Permisos[en_universo_2]: project in the universe (column AG),
            -- not discarded and not resolved before the baseline.
            (pr.en_universo_permisos IS TRUE
              AND e.nombre IS DISTINCT FROM 'Descartado'
              AND NOT COALESCE(p.fecha_resolucion < $1::date, false)) AS in_universe,
            EXISTS (
              SELECT 1 FROM permisos_comite pc
               WHERE pc.permiso_id = p.id AND pc.comite_id = $2
            ) AS in_current_committee,
            pr.urgencia AS urgency
       FROM permisos p
       JOIN proyectos pr ON pr.id = p.proyecto_id
       LEFT JOIN estados_permiso e ON e.id = p.estado_id
       LEFT JOIN organismos o ON o.id = p.organismo_id
       LEFT JOIN ministerios m ON m.id = o.ministerio_id`,
    [BASELINE_DATE, current.id],
  )

  // ALL projects: a few Table 1 terms do not filter on the universe (see
  // projectsAsOf), so the filter is applied formula by formula.
  const { rows: projects } = await pool.query<ProjectRow>(
    `SELECT pr.id::int AS id,
            pr.n_catastro AS batch,
            (pr.en_universo_permisos IS TRUE) AS in_universe,
            et.nombre AS stage,
            pr.etapa_liberados AS released_stage,
            COALESCE(pr.inversion_mmusd, 0)::float8 AS investment_mmusd,
            COALESCE(pr.empleo_construccion, 0)::int AS construction_jobs,
            pr.urgencia AS urgency,
            pr.sigue_liberado_al_contactar AS still_released_on_contact,
            pr.factibilidad AS feasibility,
            pr.estado_liberacion AS release_status,
            pr.comite_ingreso AS joined_session
       FROM proyectos pr
       LEFT JOIN etapas_proyecto et ON et.id = pr.etapa_id`,
  )
  const universeProjects = projects.filter((pr) => pr.in_universe)

  // Ministry of each agency (column B of the by-agency tables).
  const { rows: agencyRows } = await pool.query<{ agency: string; ministry: string }>(
    `SELECT o.nombre AS agency, m.nombre AS ministry
       FROM organismos o JOIN ministerios m ON m.id = o.ministerio_id`,
  )
  const ministryOf = new Map(agencyRows.map((r) => [r.agency, r.ministry]))

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

  /** sigue_liberado_al_contactar = "No" (COUNTIFS is case-insensitive: "NO" too). */
  const markedNo = (pr: ProjectRow) => pr.still_released_on_contact === false
  const isWithdrawn = (pr: ProjectRow) => pr.release_status === 'Desistido'

  /**
   * Released as of a date, before the manual corrections (the pairs of
   * COUNTIFS at the start of C12): nothing pending, last resolution <= that
   * date (or none) and not marked "No" on contact.
   */
  const releasedBy = (pr: ProjectRow, date: string) => {
    if (!hasNoPending(pr) || markedNo(pr)) return false
    const last = lastResolutionDate(pr)
    return last === null || last <= date
  }

  /**
   * Manual corrections with the "Factibilidad" column (the last part of C12
   * and of Table 2.2):
   *   + "Liberado" that the rule above does not count (has pending permits,
   *     or was marked "No" on contact);
   *   - "En curso" that the rule counts (nothing pending, not marked "No").
   */
  const feasibilityAdjustment = (pr: ProjectRow) => {
    const sp = hasNoPending(pr)
    const plus = pr.feasibility === 'Liberado' && (!sp || markedNo(pr)) ? 1 : 0
    const minus = pr.feasibility === 'En curso' && sp && !markedNo(pr) ? 1 : 0
    return plus - minus
  }

  const universe = permits.filter((p) => p.in_universe)

  // --- Summary sentence (G19) ----------------------------------------------

  const priorityGroup = (matches: (urgency: string | null) => boolean): PriorityGroup => {
    const list = universeProjects.filter((pr) => matches(pr.urgency))
    return {
      projects: list.length,
      investmentMmusd: sum(list, (pr) => pr.investment_mmusd),
      // Universe permits still "Pendiente" whose project has that priority.
      pendingPermits: universe.filter((p) => p.status === 'Pendiente' && matches(p.urgency)).length,
    }
  }
  const summary = {
    nearConstruction: priorityGroup(isNearConstruction),
    investmentOrJobs: priorityGroup(isInvestmentOrJobs),
  }

  // --- Table 1 -------------------------------------------------------------

  /**
   * C10: the projects a column counts.
   *   batch 1: all of them (this term does not filter on the universe);
   *   batch 2: in the universe, from FechaIngresoCat2, and only those that
   *            joined by that session (comite_ingreso <= session number);
   *   batch 3: in the universe, from FechaIngresoCat3.
   */
  const projectsAsOf = (date: string, sessionNumber: number | null) =>
    projects.filter((pr) => {
      if (pr.batch === 1) return true
      if (pr.batch === 2) {
        return pr.in_universe && date >= SECOND_BATCH_DATE && sessionNumber !== null &&
          pr.joined_session !== null && pr.joined_session <= sessionNumber
      }
      if (pr.batch === 3) return pr.in_universe && date >= THIRD_BATCH_DATE
      return false
    })

  const lastSessionDate = current.date // MAX(tblSesiones[Fecha])
  const columns = [
    { label: 'Línea Base', date: BASELINE_DATE, number: null as number | null },
    ...sessions.map((s) => ({ label: `Sesión ${s.number}`, date: s.date, number: s.number as number | null })),
  ]
  const table1: Table1Column[] = columns.map((col, i) => {
    const inScope = projectsAsOf(col.date, col.number)
    // C13 "Desistidos": in the universe and Estado = "Desistido".
    const withdrawn = inScope.filter((pr) => pr.in_universe && isWithdrawn(pr)).length
    // C12 "Liberados": released by that date, minus the withdrawn ones
    // among them; in the LAST session only, plus the Factibilidad corrections.
    let released = inScope.filter(
      (pr) => releasedBy(pr, col.date) && !(pr.in_universe && isWithdrawn(pr)),
    ).length
    if (col.date >= lastSessionDate) released += sum(inScope, feasibilityAdjustment)
    // C14: universe permits filed by that date.
    const filed = universe.filter((p) => p.filed_date && p.filed_date <= col.date)
    // C16: of those, resolved by that date.
    const resolved = filed.filter((p) => p.resolution_date && p.resolution_date <= col.date).length
    // D17: filed between the previous column (exclusive) and this one (inclusive).
    const prevDate = i > 0 ? columns[i - 1].date : null
    const added =
      prevDate === null
        ? null
        : universe.filter((p) => p.filed_date && p.filed_date > prevDate && p.filed_date <= col.date).length
    return {
      label: col.label,
      date: col.date,
      totalProjects: inScope.length,
      projectsInProgress: inScope.length - released - withdrawn, // C11
      releasedProjects: released,
      withdrawnProjects: withdrawn,
      totalPermits: filed.length,
      permitsInProgress: filed.length - resolved, // C15
      resolvedPermits: resolved,
      newPermits: added,
    }
  })

  // --- Tables 2.1 and 2.2 (C28:E31, C37:E40) -------------------------------

  /**
   * Groups weighted projects by stage. The sheet's total is the SUM of the 3
   * rows (not a separate count), so a project without a stage does not add
   * to the total. Same here.
   */
  const byStage = (items: { stage: string | null; weight: number; pr: ProjectRow }[]) => {
    const rows = STAGES.map((stage) => {
      const list = items.filter((x) => x.stage === stage)
      return {
        stage,
        projects: sum(list, (x) => x.weight),
        constructionJobs: sum(list, (x) => x.weight * x.pr.construction_jobs),
        investmentMmusd: sum(list, (x) => x.weight * x.pr.investment_mmusd),
      }
    })
    const total: StageRow = {
      stage: 'Total',
      projects: sum(rows, (r) => r.projects),
      constructionJobs: sum(rows, (r) => r.constructionJobs),
      investmentMmusd: sum(rows, (r) => r.investmentMmusd),
    }
    return { rows, total }
  }
  // 2.1: universe projects by etapa_proyecto.
  const table21 = byStage(universeProjects.map((pr) => ({ stage: pr.stage, weight: 1, pr })))
  // 2.2: by etapa_liberados. Released = nothing pending, not withdrawn, not
  // marked "No" (no date condition here), plus the Factibilidad corrections.
  // A project the corrections take out weighs -1, exactly like the sheet's
  // COUNTIFS/SUMIFS subtraction.
  const table22 = byStage(
    universeProjects.map((pr) => ({
      stage: pr.released_stage,
      weight: (hasNoPending(pr) && !isWithdrawn(pr) && !markedNo(pr) ? 1 : 0) + feasibilityAdjustment(pr),
      pr,
    })),
  )

  // --- Table 3 (C48:J61) ---------------------------------------------------
  //
  // Table base: universe permits filed up to the PREVIOUS session that were
  // not registered in the current committee.

  const datePrev = previous?.date ?? current.date // $R$7
  const dateCurr = current.date // $S$7
  const tableBase = universe.filter(
    (p) => p.filed_date && p.filed_date <= datePrev && !p.in_current_committee,
  )
  const ofMinistry = (list: PermitRow[], label: string) =>
    list.filter((p) => p.ministry?.startsWith(label))
  const ofAgency = (list: PermitRow[], agency: string) => list.filter((p) => p.agency === agency)
  const resolvedBy = (list: PermitRow[], date: string) =>
    list.filter((p) => p.resolution_date && p.resolution_date <= date).length
  /** F48: status Resuelto, resolved between the previous and current session. */
  const resolvedBetweenSessions = (list: PermitRow[]) =>
    list.filter(
      (p) => p.status === 'Resuelto' && p.resolution_date && p.resolution_date > datePrev && p.resolution_date <= dateCurr,
    ).length

  /** I48 / T70: universe permits registered IN the current committee. */
  const addedNow = universe.filter(
    (p) => p.in_current_committee && p.filed_date && p.filed_date <= dateCurr,
  )

  const rows3: Table3Row[] = TABLE_MINISTRIES.map((m) => {
    const ps = ofMinistry(tableBase, m.label)
    const total = ps.length // C48
    const added = ofMinistry(addedNow, m.label).length // I48
    if (!m.full) {
      // Only total and "Se añaden" in the sheet; the resolved columns are empty.
      return {
        ministry: m.label, totalAtPrevious: total, pendingAtPrevious: null, resolvedAtPrevious: null,
        resolvedBetween: null, resolvedTotal: null, progress: null, added,
        statutoryDays: m.statutoryDays, noData: !!m.noData,
      }
    }
    const resolvedAtPrevious = resolvedBy(ps, datePrev)
    const resolvedTotal = resolvedBy(ps, dateCurr) // G48
    return {
      ministry: m.label,
      totalAtPrevious: total,
      pendingAtPrevious: total - resolvedAtPrevious, // D48
      resolvedAtPrevious, // E48 = C48 - D48
      resolvedBetween: resolvedBetweenSessions(ps), // F48
      resolvedTotal,
      progress: ratio(resolvedTotal, total), // H48
      added,
      statutoryDays: m.statutoryDays, // J48 (fixed)
      noData: false,
    }
  })

  // Row 61: plain SUMs (an empty cell counts as 0); progress = G61 / C61.
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

  // --- Table 4 (C70:T84) ---------------------------------------------------

  /** D70: status Resuelto with resolution <= the session date, over Table 3's base. */
  const resolvedStatusBy = (list: PermitRow[], date: string) =>
    list.filter((p) => p.status === 'Resuelto' && p.resolution_date && p.resolution_date <= date).length

  /** IFERROR(.../0, "") -> no permits shows empty, not 0%. */
  const cumulative = (ps: PermitRow[], skip = false) =>
    sessions.map((s) => (skip || ps.length === 0 ? null : resolvedStatusBy(ps, s.date) / ps.length))

  const rows4: Table4Row[] = TABLE_MINISTRIES.map((m) => {
    const ps = ofMinistry(tableBase, m.label)
    return {
      ministry: m.label,
      total: ps.length, // C70
      progressBySession: cumulative(ps, !!m.noData),
      added: ofMinistry(addedNow, m.label).length, // T70
      noData: !!m.noData,
    }
  })
  // Total row (D83): NOTE the sheet's numerator does NOT filter by ministry
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

  // --- Urgency table (E91:P116) --------------------------------------------
  //
  // Universe permits of each agency whose project has a priority. No filing
  // date or committee filter here, unlike Tables 3/4.

  const urgencyCounts = (ps: PermitRow[]): UrgencyCounts => {
    const resolved = ps.filter((p) => p.status === 'Resuelto').length
    return {
      total: ps.length, // E91
      resolved, // F91
      resolvedBetween: resolvedBetweenSessions(ps), // G91
      resolvedShare: ps.length === 0 ? null : resolved / ps.length, // H91 = IF(E91=0,"-",F91/E91)
    }
  }
  /** M/N/O/P: the two groups added up; the % is recomputed from the sums. */
  const addCounts = (a: UrgencyCounts, b: UrgencyCounts): UrgencyCounts => {
    const total = a.total + b.total
    const resolved = a.resolved + b.resolved
    return {
      total,
      resolved,
      resolvedBetween: a.resolvedBetween + b.resolvedBetween,
      resolvedShare: total === 0 ? null : resolved / total,
    }
  }
  const urgencyRows: UrgencyRow[] = URGENCY_AGENCIES.map((agency) => {
    const ps = ofAgency(universe, agency)
    const near = urgencyCounts(ps.filter((p) => isNearConstruction(p.urgency)))
    const inv = urgencyCounts(ps.filter((p) => isInvestmentOrJobs(p.urgency)))
    return { ministry: ministryOf.get(agency) ?? '', agency, nearConstruction: near, investmentOrJobs: inv, total: addCounts(near, inv) }
  })
  // Row 116: SUMs; the % columns are the summed resolved / summed total.
  const sumCounts = (pick: (r: UrgencyRow) => UrgencyCounts): UrgencyCounts =>
    urgencyRows.map(pick).reduce(addCounts, { total: 0, resolved: 0, resolvedBetween: 0, resolvedShare: null })
  const urgencyTotal: UrgencyRow = {
    ministry: 'Total',
    agency: '',
    nearConstruction: sumCounts((r) => r.nearConstruction),
    investmentOrJobs: sumCounts((r) => r.investmentOrJobs),
    total: sumCounts((r) => r.total),
  }

  // --- Table 3.1 (D124:J149): Table 3 by agency ------------------------------

  const rows31: Table31Row[] = TABLE31_AGENCIES.map((agency) => {
    const ps = ofAgency(tableBase, agency)
    const total = ps.length // D124
    const resolvedAtPrevious = resolvedBy(ps, datePrev)
    const resolvedTotal = resolvedBy(ps, dateCurr) // H124
    return {
      ministry: ministryOf.get(agency) ?? '',
      agency,
      totalAtPrevious: total,
      pendingAtPrevious: total - resolvedAtPrevious, // E124
      resolvedAtPrevious, // F124
      resolvedBetween: resolvedBetweenSessions(ps), // G124
      resolvedTotal,
      progress: ratio(resolvedTotal, total), // I124
      added: ofAgency(addedNow, agency).length, // J124
    }
  })
  const total31 = sum(rows31, (r) => r.totalAtPrevious)
  const resolved31 = sum(rows31, (r) => r.resolvedTotal)
  const totalRow31: Table31Row = {
    ministry: 'Total',
    agency: '',
    totalAtPrevious: total31,
    pendingAtPrevious: sum(rows31, (r) => r.pendingAtPrevious),
    resolvedAtPrevious: sum(rows31, (r) => r.resolvedAtPrevious),
    resolvedBetween: sum(rows31, (r) => r.resolvedBetween),
    resolvedTotal: resolved31,
    progress: ratio(resolved31, total31), // I149
    added: sum(rows31, (r) => r.added),
  }

  // --- Table 4.1 (D156:U182): Table 4 by agency ------------------------------

  const rows41: Table41Row[] = TABLE41_AGENCIES.map((agency) => {
    const ps = ofAgency(tableBase, agency)
    return {
      ministry: ministryOf.get(agency) ?? '',
      agency,
      total: ps.length, // D156
      progressBySession: cumulative(ps), // E156
      added: ofAgency(addedNow, agency).length, // U156
    }
  })
  // Total (E181): same quirk as Table 4, the numerator counts every agency.
  const total41 = sum(rows41, (r) => r.total)
  const totalRow41: Table41Row = {
    ministry: 'Total',
    agency: '',
    total: total41,
    progressBySession: sessions.map((s) => ratio(resolvedStatusBy(tableBase, s.date), total41)),
    added: sum(rows41, (r) => r.added),
  }

  const permitsOutsideListedMinistries = tableBase.filter(
    (p) => !TABLE_MINISTRIES.some((m) => p.ministry?.startsWith(m.label)),
  ).length

  const toSession = (s: Session): Session => ({ number: s.number, date: s.date })
  return {
    computedOn: dates.today,
    baselineDate: BASELINE_DATE,
    secondBatchDate: SECOND_BATCH_DATE,
    thirdBatchDate: THIRD_BATCH_DATE,
    currentSession: toSession(current),
    previousSession: previous && toSession(previous),
    sessions: sessions.map(toSession),
    summary,
    table1,
    table21,
    table22,
    table3: { rows: rows3, total: totalRow3 },
    // Row 84, "Avance en puntos porcentuales": (E83 - D83) * 100.
    table4: { rows: rows4, total: totalRow4, pointsGained: pointsGained(totalRow4.progressBySession) },
    urgency: { rows: urgencyRows, total: urgencyTotal },
    table31: { rows: rows31, total: totalRow31 },
    table41: { rows: rows41, total: totalRow41, pointsGained: pointsGained(totalRow41.progressBySession) },
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

/** "Avance en puntos porcentuales": (this session - previous session) * 100. */
function pointsGained(progress: (number | null)[]): (number | null)[] {
  return progress.map((p, i) => (i === 0 || p === null ? null : (p - (progress[i - 1] ?? 0)) * 100))
}
