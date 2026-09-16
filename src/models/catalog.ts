import type { Pool, PoolClient } from 'pg'
import { WhereBuilder } from '../middleware/scope'
import { rcaStatusSql } from '../db/sql'

/**
 * Dropdown / filter-bar catalog data, shared by both `/catalogos` (Spanish,
 * older pages) and `/catalog` (English, dashboard filter bar). The two
 * endpoints shape the data differently, so the SQL is not byte-identical,
 * but it now lives in one place.
 */

// ---------------------------------------------------------------------------
// Used by /catalogos
// ---------------------------------------------------------------------------

export async function listMinisterios(db: Pool | PoolClient) {
  const { rows } = await db.query('SELECT id, nombre, sigla FROM ministerios ORDER BY nombre')
  return rows
}

export async function listOrganismosConMinisterio(db: Pool | PoolClient) {
  const { rows } = await db.query(
    `SELECT o.id, o.nombre, o.nombre_largo, o.ministerio_id, m.nombre AS ministerio_nombre
       FROM organismos o JOIN ministerios m ON m.id = o.ministerio_id
      ORDER BY o.nombre`,
  )
  return rows
}

export async function listEmpresas(db: Pool | PoolClient) {
  // No `WHERE activa` on purpose: this list also feeds the filter bars, and a
  // company that is no longer offered for NEW projects still has old ones that
  // must stay filterable.
  const { rows } = await db.query(
    'SELECT id, id_excel, nombre, activa FROM empresas ORDER BY nombre',
  )
  return rows
}

// ---------------------------------------------------------------------------
// Controlled vocabularies.
//
// These used to be a SELECT DISTINCT over the free-text columns of
// `proyectos`, which meant the dropdowns only offered values some project
// already had — and offered every typo along with them. They are catalog
// tables now, so each one is read straight from its table, in the order the
// catalog itself defines (`orden`, falling back to the id, which for regiones
// IS the north-to-south display order).
//
// Every one of them returns `{ id, nombre }`: the id is what a write needs
// (proyectos.region_id, permisos.estado_id) and the nombre is both what the
// user sees and what the existing name-based filters send back.
// ---------------------------------------------------------------------------

export interface ItemCatalogo {
  id: number
  nombre: string
}

/** Regions, north to south (that is what `regiones.id` orders by). */
export async function listRegiones(db: Pool | PoolClient): Promise<ItemCatalogo[]> {
  const { rows } = await db.query(
    'SELECT id, nombre, numero, codigo FROM regiones ORDER BY id',
  )
  return rows
}

export async function listSectores(db: Pool | PoolClient): Promise<ItemCatalogo[]> {
  const { rows } = await db.query('SELECT id, nombre FROM sectores ORDER BY orden, nombre')
  return rows
}

export async function listEtapas(db: Pool | PoolClient): Promise<ItemCatalogo[]> {
  const { rows } = await db.query(
    'SELECT id, nombre, codigo FROM etapas_proyecto ORDER BY orden, id',
  )
  return rows
}

export async function listEstadosPermiso(db: Pool | PoolClient): Promise<ItemCatalogo[]> {
  const { rows } = await db.query(
    'SELECT id, nombre, codigo, es_final FROM estados_permiso ORDER BY orden, id',
  )
  return rows
}

// ---------------------------------------------------------------------------
// Used by /catalog
// ---------------------------------------------------------------------------

export async function listAgencies(db: Pool | PoolClient) {
  const { rows } = await db.query(`
    SELECT o.id, o.nombre AS name, o.ministerio_id AS ministry_id
      FROM organismos o
     ORDER BY o.nombre
  `)
  return rows
}

export async function listCompaniesWithProjects(db: Pool | PoolClient) {
  const { rows } = await db.query(`
    SELECT e.id, e.nombre AS name
      FROM empresas e
     WHERE EXISTS (SELECT 1 FROM proyectos pr WHERE pr.empresa_id = e.id)
     ORDER BY e.nombre
  `)
  return rows
}

/**
 * Scoped projects with the agency ids they have permits with, for the
 * filter-bar cascade — see routes/catalog.ts for the rationale.
 */
export async function listScopedProjectsForCatalog(db: Pool | PoolClient, scope: WhereBuilder) {
  const { rows } = await db.query(
    `SELECT
       pr.id,
       pr.id_excel,
       pr.nombre                                  AS name,
       pr.empresa_id                              AS company_id,
       pr.sector,
       pr.region,
       pr.etapa                                   AS project_status,
       (${rcaStatusSql('pr.estado_ambiental')})   AS rca_status,
       -- ::int[] so the driver returns numbers; the int8 array parser
       -- would hand back strings.
       COALESCE(
         (SELECT array_agg(DISTINCT pe.organismo_id)::int[]
            FROM permisos pe WHERE pe.proyecto_id = pr.id),
         '{}'
       )                                          AS agency_ids
     FROM v_proyectos pr
     ${scope.where}
     ORDER BY pr.nombre`,
    scope.params,
  )
  return rows
}
