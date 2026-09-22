import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'
import { comites, permisosComite } from '../db/schema'

/**
 * ============================================================================
 * COMITÉ — sesiones del comité y los permisos que se revisaron en cada una.
 *
 * Verificado contra `\d comites`, `\d permisos_comite`, `\d v_resumen_comite`
 * y `\d v_permisos_comite`.
 * ============================================================================
 */

/** Columnas de la tabla base `comites`. */
/**
 * Las columnas de la tabla salen del modelo (`src/db/schema/comites.ts`), que es
 * la única fuente de verdad: no se repiten acá para que no puedan quedar
 * desincronizadas.
 */
export type Comite = typeof comites.$inferSelect

/**
 * Columnas de `permisos_comite` (relación N:N permiso <-> sesión).
 *
 * Es la sesión en la que el permiso ENTRÓ al seguimiento. Desde la migración
 * 003 las vistas ya no usan los *_snapshot: cada permiso se muestra en las
 * sesiones siguientes a la suya y todo se recalcula contra la fecha de la
 * sesión que se mira. Las columnas quedan por si vuelve a hacer falta el dato
 * congelado.
 */
/**
 * Las columnas de la tabla salen del modelo (`src/db/schema/permisosComite.ts`), que es
 * la única fuente de verdad: no se repiten acá para que no puedan quedar
 * desincronizadas.
 */
export type PermisoComite = typeof permisosComite.$inferSelect

/**
 * Una fila por sesión: lo que devuelve `v_resumen_comite`.
 *
 * IMPORTANTE, el conteo es ACUMULATIVO Y ESTRICTO (migración 003): la tabla
 * del comité N son los permisos que entraron en comités con número MENOR a N,
 * no los vinculados a N. Los que entraron en N aparecen desde N+1.
 *
 * El motivo: el Excel origen guarda un solo comité por permiso (el actual),
 * así que contar "los de esta sesión" dejaba las sesiones nuevas en cero.
 */
export interface VResumenComite {
  comite_id: number
  comite_numero: number
  comite_fecha: string
  /** Permisos de todos los comités anteriores a este. */
  permisos_en_agenda: number
  /** De esos, los que ya estaban resueltos o descartados A LA FECHA de la sesión. */
  permisos_resueltos: number
  /** Promedio de días de tramitación a la fecha de la sesión. */
  promedio_dias: number | null
}

/**
 * `v_permisos_comite` expone las MISMAS columnas que `v_permisos` (ver
 * models/permisos.ts) salvo que los cálculos van contra la fecha del comité
 * y no contra CURRENT_DATE. No trae `estado_es_final` ni `semaforo`, y agrega:
 *
 *   comite_id               number
 *   comite_numero           number         la sesión que se está mirando
 *   comite_fecha            string
 *   comite_ingreso_numero   number         la sesión en la que entró el permiso
 *                                          (siempre menor que comite_numero)
 *   compromiso              string | null  compromiso asumido en esa sesión
 *   estado_a_la_fecha       EstadoPermiso  estado que tenía ese día
 *   finalizado_a_la_fecha   boolean        si ese día ya estaba resuelto/descartado
 *   dias_tramitacion        number | null  días a la fecha de la sesión
 *
 * Un permiso aparece en TODAS las sesiones posteriores a la suya, con los
 * cálculos rehechos a la fecha de cada una (ver VResumenComite arriba).
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
