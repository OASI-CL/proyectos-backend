import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'
import { registrarCambios } from '../services/historial'
import { permisos } from '../db/schema'
import type {
  EstadoPermiso,
  EstadoPermisoCodigo,
  EstadoValidacion,
  Semaforo,
} from '../shared/types'

/**
 * ============================================================================
 * PERMISO — todas las columnas que tiene la entidad.
 *
 * Verificado contra `\d permisos` y `\d v_permisos`.
 *
 * Todo lo que lee la API sale de la VISTA `v_permisos`: resuelve el catálogo
 * de estados, trae el proyecto / organismo / empresa detrás del permiso, y
 * calcula los días de tramitación y el semáforo contra CURRENT_DATE. Las
 * escrituras van a la tabla base `permisos` y usan `estado_id`.
 * ============================================================================
 */

/** Columnas propias de la tabla base `permisos`. */
/**
 * Las columnas de la tabla salen del modelo (`src/db/schema/permisos.ts`), que es
 * la única fuente de verdad: no se repiten acá para que no puedan quedar
 * desincronizadas.
 */
export type Permiso = typeof permisos.$inferSelect

/** Columnas que AGREGA la vista `v_permisos`. Ninguna existe como columna. */
export interface VPermiso extends Permiso {
  // --- Catálogo de estados resuelto ---
  /** Nombre visible del estado. Los filtros por nombre siguen andando. */
  estado: EstadoPermiso
  /** Clave estable del estado. Preferirla al nombre en código nuevo. */
  estado_codigo: EstadoPermisoCodigo
  /** true en Resuelto/Descartado: la tramitación terminó, de una u otra forma. */
  estado_es_final: boolean
  // --- Contexto: proyecto, organismo, ministerio, empresa ---
  proyecto_nombre: string
  proyecto_id_excel: string | null
  organismo_nombre: string
  ministerio_id: number
  ministerio_nombre: string
  empresa_id: number
  empresa_nombre: string
  // --- Del proyecto: la pantalla de Permisos filtra por estos campos ---
  region_id: number | null
  region: string | null
  sector_id: number | null
  sector: string | null
  etapa_id: number | null
  etapa: string | null
  inversion_mmusd: number | null
  // --- Derivados contra CURRENT_DATE ---
  /**
   * Días desde fecha_ingreso hasta fecha_resolucion (si ya se resolvió) o
   * hasta hoy (si sigue pendiente). NULL si no hay fecha_ingreso.
   */
  dias_tramitacion: number | null
  menos_3_meses: boolean | null
  entre_3_y_6_meses: boolean | null
  supera_6_meses: boolean | null
  /** finalizado | critico (>180d) | en_alerta (>=90d) | en_plazo. */
  semaforo: Semaforo
}

// Columnas de la planilla origen agregadas el 22-09-2026 (ver
// src/db/schema/permisos.ts para el detalle de cada una):
//   en_universo, fecha_registro_catastro, fecha_actualizacion, quien_actualizo
// Ya están en `Permiso` (vienen del modelo). `estado` ahora puede valer
// también 'Desistido' además de 'Pendiente'/'Resuelto'/'Descartado' — ver
// EstadoPermiso en shared/types.ts.

/** Traduce los query params de filtro a condiciones SQL sobre v_permisos. */
export function filtrosPermisos(wb: WhereBuilder, q: Record<string, unknown>) {
  const s = (k: string) => (typeof q[k] === 'string' && q[k] !== '' ? String(q[k]) : undefined)
  const n = (k: string) => (s(k) !== undefined && !Number.isNaN(Number(s(k))) ? Number(s(k)) : undefined)

  if (n('organismo_id') !== undefined) wb.add((i) => `organismo_id = $${i}`, n('organismo_id'))
  if (n('ministerio_id') !== undefined) wb.add((i) => `ministerio_id = $${i}`, n('ministerio_id'))
  if (n('empresa_id') !== undefined) wb.add((i) => `empresa_id = $${i}`, n('empresa_id'))
  if (n('proyecto_id') !== undefined) wb.add((i) => `proyecto_id = $${i}`, n('proyecto_id'))
  // Estado/región/sector aceptan el nombre (lo que manda la barra de filtros,
  // la vista lo sigue exponiendo) o el id del catálogo.
  if (s('estado')) wb.add((i) => `estado = $${i}`, s('estado'))
  if (n('estado_id') !== undefined) wb.add((i) => `estado_id = $${i}`, n('estado_id'))
  if (s('region')) wb.add((i) => `region = $${i}`, s('region'))
  if (n('region_id') !== undefined) wb.add((i) => `region_id = $${i}`, n('region_id'))
  if (s('sector')) wb.add((i) => `sector = $${i}`, s('sector'))
  if (n('sector_id') !== undefined) wb.add((i) => `sector_id = $${i}`, n('sector_id'))
  if (s('id_excel')) wb.add((i) => `id_excel = $${i}`, s('id_excel'))

  if (s('critico') === 'true') wb.addRaw('critico IS TRUE')
  if (s('critico') === 'false') wb.addRaw('critico IS FALSE')
  if (s('habilitante') === 'true') wb.addRaw('habilitante_construccion IS TRUE')
  if (s('habilitante') === 'false') wb.addRaw('habilitante_construccion IS FALSE')

  // Tramo de tramitación
  if (s('tramo') === 'menos_3') wb.addRaw('menos_3_meses IS TRUE')
  if (s('tramo') === 'entre_3_6') wb.addRaw('entre_3_y_6_meses IS TRUE')
  if (s('tramo') === 'mas_6') wb.addRaw('supera_6_meses IS TRUE')

  if (s('semaforo')) wb.add((i) => `semaforo = $${i}`, s('semaforo'))

  if (s('fecha_ingreso_desde')) wb.add((i) => `fecha_ingreso >= $${i}`, s('fecha_ingreso_desde'))
  if (s('fecha_ingreso_hasta')) wb.add((i) => `fecha_ingreso <= $${i}`, s('fecha_ingreso_hasta'))

  // Búsqueda libre por nombre de permiso o de proyecto
  if (s('q')) {
    wb.add((i) => `(nombre ILIKE '%' || $${i} || '%' OR proyecto_nombre ILIKE '%' || $${i} || '%')`, s('q'))
  }

  return wb
}

export const COLUMNAS_ORDENABLES_PERMISOS = new Set([
  'id', 'id_excel', 'nombre', 'estado', 'fecha_ingreso', 'dias_tramitacion',
  'organismo_nombre', 'proyecto_nombre', 'empresa_nombre', 'semaforo',
])

export async function countPermisos(db: Pool | PoolClient, wb: WhereBuilder): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS total FROM v_permisos ${wb.where}`, wb.params)
  return rows[0].total
}

export async function listPermisosPaginado(
  db: Pool | PoolClient,
  wb: WhereBuilder,
  sortBy: string,
  sortDir: 'ASC' | 'DESC',
  pageSize: number,
  offset: number,
) {
  const limitIdx = wb.push(pageSize)
  const offsetIdx = wb.push(offset)
  const { rows } = await db.query(
    `SELECT * FROM v_permisos ${wb.where}
     ORDER BY ${sortBy} ${sortDir} NULLS LAST, id ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    wb.params,
  )
  return rows
}

export async function listPermisosParaExport(db: Pool | PoolClient, wb: WhereBuilder) {
  const { rows } = await db.query(
    `SELECT id_excel, nombre, organismo_nombre, ministerio_nombre, proyecto_id_excel,
            proyecto_nombre, empresa_nombre, region, sector, estado, fecha_ingreso,
            fecha_resolucion, dias_tramitacion, semaforo, critico, habilitante_construccion,
            n_expediente, observaciones
       FROM v_permisos ${wb.where}
      ORDER BY dias_tramitacion DESC NULLS LAST`,
    wb.params,
  )
  return rows
}

export async function getPermisoPorId(db: Pool | PoolClient, wb: WhereBuilder, id: number) {
  wb.add((i) => `id = $${i}`, id)
  const { rows } = await db.query(`SELECT * FROM v_permisos ${wb.where}`, wb.params)
  return rows[0] ?? null
}

export async function permisoVisibleId(db: Pool | PoolClient, wb: WhereBuilder, id: number): Promise<boolean> {
  wb.add((i) => `id = $${i}`, id)
  const { rows } = await db.query(`SELECT id FROM v_permisos ${wb.where}`, wb.params)
  return rows.length > 0
}

export async function listHistorialPermiso(db: Pool | PoolClient, id: number) {
  const { rows } = await db.query(
    `SELECT * FROM v_historial WHERE entidad = 'permiso' AND entidad_id = $1`,
    [id],
  )
  return rows
}

/** Fetches the raw permisos row (scoped), for the direct-write path. */
export async function getPermisoDirectoConScope(client: PoolClient, wbScope: WhereBuilder, id: number) {
  wbScope.add((i) => `id = $${i}`, id)
  const previo = await client.query(
    `SELECT p.* FROM permisos p
      WHERE p.id IN (SELECT id FROM v_permisos ${wbScope.where})`,
    wbScope.params,
  )
  return previo.rows[0] ?? null
}

/** Direct write path (OASI/admin): UPDATE + historial row, inside the caller's transaction. */
export async function aplicarCambiosPermiso(
  client: PoolClient,
  id: number,
  anterior: Record<string, unknown>,
  cambios: Record<string, unknown>,
  updatedBySub: string,
) {
  const sets = Object.keys(cambios).map((campo, i) => `${campo} = $${i + 1}`)
  const valores = Object.values(cambios)
  valores.push(updatedBySub) // updated_by
  valores.push(id)

  const actualizado = await client.query(
    `UPDATE permisos SET ${sets.join(', ')}, updated_by = $${valores.length - 1}
       WHERE id = $${valores.length} RETURNING *`,
    valores,
  )

  await registrarCambios(client, 'permiso', id, anterior, cambios, updatedBySub)
  return actualizado.rows[0]
}
