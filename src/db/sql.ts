/**
 * Shared SQL expressions.
 *
 * NOTE ON LANGUAGE: the database schema (db/schema.sql) is in Spanish because
 * it already holds production data. Application code is in English, so every
 * query aliases columns to English names at this boundary.
 */

/**
 * Builds parameterised SQL safely. Hands out $1, $2, ... placeholders and
 * keeps the matching value array, so several CTEs in one statement can share
 * a single continuous parameter list.
 */
export class SqlParams {
  private values: unknown[] = []

  /** Registers a value and returns its placeholder (e.g. "$3"). */
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }

  get params(): unknown[] {
    return this.values
  }
}

/**
 * Permit tracking status — the three states every permit visualisation uses.
 *
 *   pending  — still in process, expected resolution date not passed
 *   overdue  — still pending, expected resolution date already passed
 *   resolved — process finished (includes 'Descartado': the process ended too)
 *
 * IMPORTANT: only 27 of the 895 pending permits carry an explicit
 * `fecha_resolucion_estimada`, so a rule based purely on that date would
 * leave ~97% of permits unclassifiable. When the expected date is missing we
 * fall back to the 180-day threshold the OASI team already used in the
 * source spreadsheet ("Supera 6 Meses").
 *
 * Expects the source table aliased as `p` (v_permisos).
 */
export const OVERDUE_THRESHOLD_DAYS = 180

export const PERMIT_TRACKING_STATUS_SQL = `
  CASE
    WHEN p.estado IN ('Resuelto', 'Descartado') THEN 'resolved'
    WHEN p.fecha_resolucion_estimada IS NOT NULL
         AND p.fecha_resolucion_estimada < CURRENT_DATE THEN 'overdue'
    WHEN p.fecha_resolucion_estimada IS NULL
         AND p.dias_tramitacion > ${OVERDUE_THRESHOLD_DAYS} THEN 'overdue'
    ELSE 'pending'
  END`

/**
 * How many days past due a permit is. Uses the explicit expected date when
 * present, otherwise days beyond the 180-day threshold.
 */
export const OVERDUE_DAYS_SQL = `
  CASE
    WHEN p.estado IN ('Resuelto', 'Descartado') THEN NULL
    WHEN p.fecha_resolucion_estimada IS NOT NULL
      THEN GREATEST(CURRENT_DATE - p.fecha_resolucion_estimada, 0)
    WHEN p.dias_tramitacion > ${OVERDUE_THRESHOLD_DAYS}
      THEN p.dias_tramitacion - ${OVERDUE_THRESHOLD_DAYS}
    ELSE NULL
  END`

/**
 * Environmental permit (RCA) status of a project.
 *
 * The source column `proyectos.estado_ambiental` is empty for 314 of 317
 * projects, so almost everything falls into 'unknown' until the team fills
 * that data in. The ILIKE patterns use `_` as a single-character wildcard so
 * they match both accented and unaccented spellings ("trámite"/"tramite").
 *
 * Takes the column expression as an argument so it works against either
 * `proyectos` or `v_proyectos`.
 */
export function rcaStatusSql(column: string): string {
  return `
  CASE
    WHEN ${column} IS NULL OR btrim(${column}) = '' THEN 'unknown'
    WHEN ${column} ILIKE '%aprob%'                  THEN 'approved'
    WHEN ${column} ILIKE '%suspend%'                THEN 'suspended'
    WHEN ${column} ILIKE '%tr_mite%'
      OR ${column} ILIKE '%evalua%'                 THEN 'in_review'
    ELSE 'other'
  END`
}
