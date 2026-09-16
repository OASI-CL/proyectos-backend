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
  const { rows } = await db.query('SELECT id, nombre FROM ministerios ORDER BY nombre')
  return rows
}

export async function listOrganismosConMinisterio(db: Pool | PoolClient) {
  const { rows } = await db.query(
    `SELECT o.id, o.nombre, o.ministerio_id, m.nombre AS ministerio_nombre
       FROM organismos o JOIN ministerios m ON m.id = o.ministerio_id
      ORDER BY o.nombre`,
  )
  return rows
}

export async function listEmpresas(db: Pool | PoolClient) {
  const { rows } = await db.query('SELECT id, id_excel, nombre FROM empresas ORDER BY nombre')
  return rows
}

/** Distinct values for a proyectos column (region/sector/etapa), unscoped. */
export async function listDistinctProyectoValues(
  db: Pool | PoolClient,
  columna: 'region' | 'sector' | 'etapa',
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT ${columna} AS valor FROM proyectos
      WHERE ${columna} IS NOT NULL ORDER BY valor`,
  )
  return rows.map((r) => r.valor)
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
