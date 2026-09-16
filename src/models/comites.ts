import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'

/**
 * ============================================================================
 * COMITÉ — sesiones del comité y los permisos que se revisaron en cada una.
 *
 * Verificado contra `\d comites`, `\d permisos_comite`, `\d v_resumen_comite`
 * y `\d v_permisos_comite`.
 * ============================================================================
 */

/** Columnas de la tabla base `comites`. */
export interface Comite {
  id: number
  /** Número de sesión. UNIQUE: es como se la nombra ("comité 7"). */
  numero: number
  fecha: string
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Columnas de `permisos_comite` (relación N:N permiso <-> sesión).
 *
 * Los *_snapshot congelan cómo estaba el permiso el día de esa sesión, para
 * poder reconstruir la tabla exacta que se presentó en el comité aunque el
 * permiso haya avanzado después.
 */
export interface PermisoComite {
  id: number
  permiso_id: number
  comite_id: number
  /** FK a `estados_permiso`: el estado congelado a la fecha de la sesión. */
  estado_snapshot_id: number | null
  dias_snapshot: number | null
  compromiso: string | null
}

/** Una fila por sesión: lo que devuelve `v_resumen_comite`. */
export interface VResumenComite {
  comite_id: number
  comite_numero: number
  comite_fecha: string
  permisos_en_agenda: number
  permisos_resueltos: number
  /** Promedio de días de tramitación a la fecha de la sesión. */
  promedio_dias: number | null
}

/**
 * `v_permisos_comite` expone las MISMAS columnas que `v_permisos` (ver
 * models/permisos.ts) salvo que los cálculos van contra la fecha del comité
 * y no contra CURRENT_DATE. No trae `estado_es_final` ni `semaforo`, y agrega:
 *
 *   comite_id          number
 *   comite_numero      number
 *   comite_fecha       string
 *   compromiso         string | null   compromiso asumido en esa sesión
 *   estado_a_la_fecha  EstadoPermiso   snapshot guardado, o reconstruido
 *   dias_tramitacion   number | null   snapshot guardado, o recalculado
 */

export async function listComites(db: Pool | PoolClient) {
  const { rows } = await db.query(
    `SELECT comite_id, comite_numero, comite_fecha, permisos_en_agenda,
            permisos_resueltos, round(promedio_dias)::int AS promedio_dias
       FROM v_resumen_comite
      ORDER BY comite_numero DESC`,
  )
  return rows
}

export async function getComiteByNumero(db: Pool | PoolClient, numero: number) {
  const { rows } = await db.query(
    `SELECT comite_id, comite_numero, comite_fecha, permisos_en_agenda,
            permisos_resueltos, round(promedio_dias)::int AS promedio_dias
       FROM v_resumen_comite WHERE comite_numero = $1`,
    [numero],
  )
  return rows[0] ?? null
}

export async function listPermisosPorComite(db: Pool | PoolClient, wb: WhereBuilder, numero: number) {
  wb.add((i) => `comite_numero = $${i}`, numero)
  const { rows } = await db.query(
    `SELECT * FROM v_permisos_comite ${wb.where}
      ORDER BY dias_tramitacion DESC NULLS LAST`,
    wb.params,
  )
  return rows
}
