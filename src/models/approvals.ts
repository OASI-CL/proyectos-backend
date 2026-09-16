import type { Pool, PoolClient } from 'pg'
import type { UsuarioAutenticado } from '../middleware/auth'
import { WhereBuilder, puedeAprobar } from '../middleware/scope'

/**
 * Scoping for the approvals queue (v_solicitudes_cambio).
 *
 * OASI/admin see every request. The other roles see the requests that fall
 * inside the scope they already have access to — not just the ones they
 * personally submitted, so a colleague at the same agency can follow up on
 * what the team sent. Scoping by entity (rather than by submitter) also means
 * the queue can never show a record the user is not allowed to read.
 */
export function scopeSolicitudes(wb: WhereBuilder, user: UsuarioAutenticado | undefined) {
  if (!user || puedeAprobar(user)) return wb

  if (user.rol === 'empresa') {
    wb.add((n) => `empresa_id = $${n}`, user.empresaId ?? -1)
  } else if (user.rol === 'organismo') {
    wb.add((n) => `organismo_id = $${n}`, user.organismoId ?? -1)
  } else if (user.rol === 'region') {
    wb.add((n) => `region = $${n}`, user.region ?? '')
  }
  return wb
}

export async function listSolicitudes(db: Pool | PoolClient, wb: WhereBuilder, estado: string, limit: number) {
  if (estado !== 'todas') {
    wb.add((n) => `estado = $${n}`, estado)
  }
  const limitIdx = wb.push(limit)

  const { rows } = await db.query(
    `SELECT * FROM v_solicitudes_cambio ${wb.where}
      ORDER BY solicitado_at DESC
      LIMIT $${limitIdx}`,
    wb.params,
  )
  return rows
}

export async function countSolicitudesPendientes(
  db: Pool | PoolClient,
  wb: WhereBuilder,
  user: UsuarioAutenticado | undefined,
): Promise<number> {
  wb.addRaw(`estado = 'pendiente'`)
  scopeSolicitudes(wb, user)
  const { rows } = await db.query(
    `SELECT count(*)::int AS pendientes FROM v_solicitudes_cambio ${wb.where}`,
    wb.params,
  )
  return rows[0].pendientes
}
