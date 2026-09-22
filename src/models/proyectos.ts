import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'
import type { EstadoValidacion, EtapaProyectoCodigo } from '../shared/types'
import { proyectos } from '../db/schema'

/**
 * ============================================================================
 * PROYECTO — todas las columnas que tiene la entidad.
 *
 * Esta es la lista completa y verificada contra la base (`\d proyectos` y
 * `\d v_proyectos`). Sirve para saber qué se puede exponer en un endpoint
 * nuevo sin tener que abrir psql.
 *
 * Casi todo lo que devuelve la API sale de la VISTA `v_proyectos`, no de la
 * tabla: la vista resuelve los catálogos (region_id -> "Antofagasta") y
 * agrega los conteos de permisos. Escribir, en cambio, es siempre contra la
 * tabla base `proyectos` y con los *_id.
 * ============================================================================
 */

/** Columnas propias de la tabla base `proyectos`. */
/**
 * Las columnas de la tabla salen del modelo (`src/db/schema/proyectos.ts`), que es
 * la única fuente de verdad: no se repiten acá para que no puedan quedar
 * desincronizadas.
 */
export type Proyecto = typeof proyectos.$inferSelect

/**
 * Columnas que AGREGA la vista `v_proyectos` sobre la tabla.
 * Ninguna existe como columna: son catálogos resueltos o agregados.
 */
export interface VProyecto extends Proyecto {
  // --- Catálogos resueltos a nombre legible ---
  empresa_nombre: string
  /** Nombre de la región de region_id. Los filtros por nombre siguen andando. */
  region: string | null
  /** Número oficial de la región. NULL en Interregional / Nivel Central. */
  region_numero: number | null
  /** Numeral romano ('II', 'RM', ...). NULL en las dos pseudo-regiones. */
  region_codigo: string | null
  sector: string | null
  etapa: string | null
  /** Clave estable de la etapa. Preferirla al nombre en código nuevo. */
  etapa_codigo: EtapaProyectoCodigo | null
  // --- Agregados sobre los permisos del proyecto ---
  total_permisos: number
  permisos_pendientes: number
  /** Pendientes con más de 180 días desde su fecha_ingreso. */
  permisos_6meses: number
  criticos_pendientes: number
  /** true cuando no le queda ningún permiso pendiente. */
  sin_pendientes: boolean
}

export function filtrosProyectos(wb: WhereBuilder, q: Record<string, unknown>) {
  const s = (k: string) => (typeof q[k] === 'string' && q[k] !== '' ? String(q[k]) : undefined)
  const n = (k: string) => (s(k) !== undefined && !Number.isNaN(Number(s(k))) ? Number(s(k)) : undefined)

  if (n('empresa_id') !== undefined) wb.add((i) => `empresa_id = $${i}`, n('empresa_id'))
  // Región/sector/etapa aceptan el nombre (lo que manda la barra de filtros,
  // la vista lo sigue exponiendo) o el id del catálogo.
  if (s('sector')) wb.add((i) => `sector = $${i}`, s('sector'))
  if (n('sector_id') !== undefined) wb.add((i) => `sector_id = $${i}`, n('sector_id'))
  if (s('region')) wb.add((i) => `region = $${i}`, s('region'))
  if (n('region_id') !== undefined) wb.add((i) => `region_id = $${i}`, n('region_id'))
  if (s('etapa')) wb.add((i) => `etapa = $${i}`, s('etapa'))
  if (n('etapa_id') !== undefined) wb.add((i) => `etapa_id = $${i}`, n('etapa_id'))
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
  /** Ids de catálogo (regiones / sectores / etapas_proyecto), no nombres. */
  regionId?: unknown
  sectorId?: unknown
  etapaId?: unknown
  inversionMmusd?: unknown
  empleoConstruccion?: unknown
  empleoOperacion?: unknown
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
       nombre, titular, empresa_id, region_id, sector_id, inversion_mmusd,
       empleo_construccion, empleo_operacion, etapa_id, estado_ambiental,
       fecha_inicio_construccion, fecha_inicio_operacion, observaciones_oasi,
       estado_validacion, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      datos.nombre, datos.titular ?? null, datos.empresaId,
      datos.regionId ?? null, datos.sectorId ?? null,
      datos.inversionMmusd ?? null, datos.empleoConstruccion ?? null, datos.empleoOperacion ?? null,
      datos.etapaId ?? null, datos.estadoAmbiental ?? null, datos.fechaInicioConstruccion || null,
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
  /** Id del catálogo `estados_permiso`. Si no viene, queda 1 = Pendiente. */
  estadoId?: unknown
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
       n_expediente, critico, que_habilita, habilitante_construccion, estado_id,
       fecha_ingreso, fecha_resolucion_estimada, observaciones,
       estado_validacion, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      datos.proyectoId, datos.organismoId, datos.nombre, datos.nombreEstandar ?? null,
      datos.tipoPermiso ?? null, datos.nExpediente ?? null, datos.critico ?? false,
      datos.queHabilita ?? null, datos.habilitanteConstruccion ?? false,
      // 1 = 'Pendiente' (id explícito y estable del catálogo estados_permiso).
      datos.estadoId ?? 1, datos.fechaIngreso || null,
      datos.fechaResolucionEstimada || null, datos.observaciones ?? null,
      datos.estadoValidacion, datos.creadoPorSub,
    ],
  )
  return rows[0]
}
