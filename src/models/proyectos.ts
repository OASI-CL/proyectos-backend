import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'

export function filtrosProyectos(wb: WhereBuilder, q: Record<string, unknown>) {
  const s = (k: string) => (typeof q[k] === 'string' && q[k] !== '' ? String(q[k]) : undefined)
  const n = (k: string) => (s(k) !== undefined && !Number.isNaN(Number(s(k))) ? Number(s(k)) : undefined)

  if (n('empresa_id') !== undefined) wb.add((i) => `empresa_id = $${i}`, n('empresa_id'))
  if (s('sector')) wb.add((i) => `sector = $${i}`, s('sector'))
  if (s('region')) wb.add((i) => `region = $${i}`, s('region'))
  if (s('etapa')) wb.add((i) => `etapa = $${i}`, s('etapa'))
  if (s('id_excel')) wb.add((i) => `id_excel = $${i}`, s('id_excel'))
  if (s('con_permisos_6meses') === 'true') wb.addRaw('permisos_6meses > 0')
  if (s('sin_pendientes') === 'true') wb.addRaw('sin_pendientes IS TRUE')
  if (s('sin_pendientes') === 'false') wb.addRaw('sin_pendientes IS FALSE')
  if (s('q')) wb.add((i) => `nombre ILIKE '%' || $${i} || '%'`, s('q'))

  return wb
}

export const COLUMNAS_ORDENABLES_PROYECTOS = new Set([
  'id', 'id_excel', 'nombre', 'empresa_nombre', 'sector', 'region', 'etapa',
  'inversion_mmusd', 'total_permisos', 'permisos_pendientes', 'permisos_6meses',
])

export async function countProyectos(db: Pool | PoolClient, wb: WhereBuilder): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS total FROM v_proyectos ${wb.where}`, wb.params)
  return rows[0].total
}

export async function listProyectosPaginado(
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
    `SELECT * FROM v_proyectos ${wb.where}
     ORDER BY ${sortBy} ${sortDir} NULLS LAST, id ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    wb.params,
  )
  return rows
}

export async function getProyectoPorId(db: Pool | PoolClient, wb: WhereBuilder, id: number) {
  wb.add((i) => `id = $${i}`, id)
  const { rows } = await db.query(`SELECT * FROM v_proyectos ${wb.where}`, wb.params)
  return rows[0] ?? null
}

export async function listPermisosDeProyecto(db: Pool | PoolClient, wb: WhereBuilder, proyectoId: number) {
  wb.add((i) => `proyecto_id = $${i}`, proyectoId)
  const { rows } = await db.query(
    `SELECT * FROM v_permisos ${wb.where} ORDER BY dias_tramitacion DESC NULLS LAST`,
    wb.params,
  )
  return rows
}

export async function proyectoVisibleId(db: Pool | PoolClient, wb: WhereBuilder, id: number): Promise<boolean> {
  wb.add((i) => `id = $${i}`, id)
  const { rows } = await db.query(`SELECT id FROM v_proyectos ${wb.where}`, wb.params)
  return rows.length > 0
}

export interface DatosProyectoNuevo {
  nombre: string
  titular?: unknown
  empresaId: unknown
  region?: unknown
  sector?: unknown
  inversionMmusd?: unknown
  empleoConstruccion?: unknown
  empleoOperacion?: unknown
  etapa?: unknown
  estadoAmbiental?: unknown
  fechaInicioConstruccion?: unknown
  fechaInicioOperacion?: unknown
  observacionesOasi?: unknown
  estadoValidacion: string
  creadoPorSub: string
}

/** INSERT INTO proyectos, inside the caller's transaction. */
export async function crearProyecto(client: PoolClient, datos: DatosProyectoNuevo) {
  const { rows } = await client.query(
    `INSERT INTO proyectos (
       nombre, titular, empresa_id, region, sector, inversion_mmusd,
       empleo_construccion, empleo_operacion, etapa, estado_ambiental,
       fecha_inicio_construccion, fecha_inicio_operacion, observaciones_oasi,
       estado_validacion, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      datos.nombre, datos.titular ?? null, datos.empresaId, datos.region ?? null, datos.sector ?? null,
      datos.inversionMmusd ?? null, datos.empleoConstruccion ?? null, datos.empleoOperacion ?? null,
      datos.etapa ?? null, datos.estadoAmbiental ?? null, datos.fechaInicioConstruccion || null,
      datos.fechaInicioOperacion || null, datos.observacionesOasi ?? null,
      datos.estadoValidacion, datos.creadoPorSub,
    ],
  )
  return rows[0]
}

export interface DatosPermisoNuevo {
  proyectoId: number
  organismoId: unknown
  nombre: string
  nombreEstandar?: unknown
  tipoPermiso?: unknown
  nExpediente?: unknown
  critico?: unknown
  queHabilita?: unknown
  habilitanteConstruccion?: unknown
  estado?: unknown
  fechaIngreso?: unknown
  fechaResolucionEstimada?: unknown
  observaciones?: unknown
  estadoValidacion: string
  creadoPorSub: string
}

/** INSERT INTO permisos (as part of a project), inside the caller's transaction. */
export async function crearPermisoDeProyecto(client: PoolClient, datos: DatosPermisoNuevo) {
  const { rows } = await client.query(
    `INSERT INTO permisos (
       proyecto_id, organismo_id, nombre, nombre_estandar, tipo_permiso,
       n_expediente, critico, que_habilita, habilitante_construccion, estado,
       fecha_ingreso, fecha_resolucion_estimada, observaciones,
       estado_validacion, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      datos.proyectoId, datos.organismoId, datos.nombre, datos.nombreEstandar ?? null,
      datos.tipoPermiso ?? null, datos.nExpediente ?? null, datos.critico ?? false,
      datos.queHabilita ?? null, datos.habilitanteConstruccion ?? false,
      datos.estado ?? 'Pendiente', datos.fechaIngreso || null,
      datos.fechaResolucionEstimada || null, datos.observaciones ?? null,
      datos.estadoValidacion, datos.creadoPorSub,
    ],
  )
  return rows[0]
}
