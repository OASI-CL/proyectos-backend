import type { Pool, PoolClient } from 'pg'
import type { UsuarioAutenticado } from '../middleware/auth'
import { WhereBuilder, puedeAprobar } from '../middleware/scope'
import type { EntidadSolicitud, EstadoSolicitud, TipoSolicitud } from '../shared/types'
import { solicitudesCambio } from '../db/schema'

/**
 * ============================================================================
 * SOLICITUD DE CAMBIO — la cola de aprobaciones.
 *
 * Verificado contra `\d solicitudes_cambio` y `\d v_solicitudes_cambio`.
 * ============================================================================
 */

/** Columnas de la tabla base `solicitudes_cambio`. */
/**
 * Las columnas de la tabla salen del modelo (`src/db/schema/solicitudesCambio.ts`), que es
 * la única fuente de verdad: no se repiten acá para que no puedan quedar
 * desincronizadas.
 */
export type SolicitudCambio = typeof solicitudesCambio.$inferSelect

/**
 * Columnas que AGREGA la vista `v_solicitudes_cambio`: el contexto que
 * necesita la pantalla de aprobaciones, para no hacer tres round trips por
 * fila, más las columnas de alcance con las que se filtra la cola.
 */
export interface VSolicitudCambio extends SolicitudCambio {
  solicitado_por_nombre: string | null
  revisado_por_nombre: string | null
  /** Nombre del proyecto o del permiso al que apunta entidad_id. */
  entidad_nombre: string | null
  entidad_id_excel: string | null
  // --- Columnas de alcance (ver scopeSolicitudes más abajo) ---
  empresa_id: number | null
  empresa_nombre: string | null
  organismo_id: number | null
  organismo_nombre: string | null
  region_id: number | null
  region: string | null
}

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
    wb.add((n) => `region_id = $${n}`, user.regionId ?? -1)
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
