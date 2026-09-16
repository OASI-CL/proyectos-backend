import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'

/**
 * Per-agency summary (pending, over 6 months, average days, blocked
 * investment), scoped by the caller's WhereBuilder over v_permisos.
 */
export async function resumenPorOrganismo(db: Pool | PoolClient, wb: WhereBuilder) {
  const { rows } = await db.query(
    `SELECT
       p.organismo_id,
       p.organismo_nombre,
       p.ministerio_nombre,
       count(*) FILTER (WHERE p.estado = 'Pendiente')::int              AS pendientes,
       count(*) FILTER (WHERE p.estado = 'Pendiente'
                          AND p.supera_6_meses)::int                    AS supera_6_meses,
       round(avg(p.dias_tramitacion)
             FILTER (WHERE p.estado = 'Pendiente'))::int                AS promedio_dias,
       COALESCE((
         SELECT sum(DISTINCT_pr.inversion_mmusd)
           FROM (
             SELECT DISTINCT p2.proyecto_id, p2.inversion_mmusd
               FROM v_permisos p2
              WHERE p2.organismo_id = p.organismo_id
                AND p2.estado = 'Pendiente'
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
