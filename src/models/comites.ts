import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'

/**
 * Comité sessions (v_resumen_comite / v_permisos_comite). Query shapes moved
 * verbatim from routes/comites.ts.
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
