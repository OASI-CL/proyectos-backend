import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'

/**
 * ============================================================================
 * ORGANISMO / MINISTERIO — el organigrama del Estado.
 *
 * Son catálogos: vienen con datos semilla en db/schema.sql y no se cargan
 * desde el Excel. Un organismo (CONAF, DGA, SEA, ...) pertenece siempre a un
 * ministerio. Verificado contra `\d organismos` y `\d ministerios`.
 * ============================================================================
 */

export interface Ministerio {
  id: number
  nombre: string
  /** 'MOP', 'MINVU', ... NULL en 'Municipalidades', que no tiene sigla. */
  sigla: string | null
}

export interface Organismo {
  id: number
  /** Sigla tal como viene del Excel. Solo display, nunca FK. */
  id_excel: string | null
  /** Sigla con la que se lo conoce, ej. 'CONAF'. UNIQUE. */
  nombre: string
  /** Nombre completo, para informes formales. */
  nombre_largo: string | null
  ministerio_id: number
}

/** Una fila por organismo: lo que devuelve `v_resumen_organismo`. */
export interface VResumenOrganismo {
  organismo_id: number
  organismo_nombre: string
  ministerio_id: number
  ministerio_nombre: string
  pendientes: number
  /** Pendientes con más de 180 días desde su fecha_ingreso. */
  supera_6_meses: number
  promedio_dias: number | null
  /** Suma de inversión de los proyectos con >=1 permiso pendiente acá. */
  inversion_bloqueada_mmusd: number | null
}

/**
 * Per-agency summary (pending, over 6 months, average days, blocked
 * investment), scoped by the caller's WhereBuilder over v_permisos.
 *
 * "Pending" is matched on `estado_codigo` (the stable key of the
 * estados_permiso catalog) rather than on the display name, so renaming the
 * state in the catalog cannot silently zero these counters.
 */
export async function resumenPorOrganismo(db: Pool | PoolClient, wb: WhereBuilder) {
  const { rows } = await db.query(
    `SELECT
       p.organismo_id,
       p.organismo_nombre,
       p.ministerio_nombre,
       count(*) FILTER (WHERE p.estado_codigo = 'pendiente')::int       AS pendientes,
       count(*) FILTER (WHERE p.estado_codigo = 'pendiente'
                          AND p.supera_6_meses)::int                    AS supera_6_meses,
       round(avg(p.dias_tramitacion)
             FILTER (WHERE p.estado_codigo = 'pendiente'))::int         AS promedio_dias,
       COALESCE((
         SELECT sum(DISTINCT_pr.inversion_mmusd)
           FROM (
             SELECT DISTINCT p2.proyecto_id, p2.inversion_mmusd
               FROM v_permisos p2
              WHERE p2.organismo_id = p.organismo_id
                AND p2.estado_codigo = 'pendiente'
           ) AS DISTINCT_pr
       ), 0)                                                            AS inversion_bloqueada_mmusd
     FROM v_permisos p
     ${wb.where}
     GROUP BY p.organismo_id, p.organismo_nombre, p.ministerio_nombre
     ORDER BY pendientes DESC`,
    wb.params,
  )
  return rows
}
