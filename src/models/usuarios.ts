import type { Pool, PoolClient } from 'pg'
import type { RolUsuario } from '../shared/types'
import { usuarios } from '../db/schema'

/**
 * ============================================================================
 * usuarios — quién entra al sistema, con qué rol y sobre qué alcance.
 *
 * Columnas de la tabla base `usuarios`:
 *   id            number    PK
 *   cognito_sub   string    sub del usuario en el User Pool. UNIQUE. Es la
 *                           identidad real: el JWT trae esto y no el id.
 *   nombre        string
 *   email         string
 *   rol           RolUsuario  'admin' | 'oasi' | 'organismo' | 'empresa' | 'region'
 *   empresa_id    number|null alcance del rol 'empresa'
 *   organismo_id  number|null alcance del rol 'organismo'
 *   region_id     number|null alcance del rol 'region' (FK a regiones)
 *   created_by / updated_by / created_at / updated_at   auditoría
 *
 * Un CHECK en el schema obliga a que cada rol acotado traiga su alcance.
 *
 * Columnas que agrega la vista `v_usuarios` (catálogos resueltos):
 *   empresa_nombre    string|null
 *   organismo_nombre  string|null
 *   region            string|null   nombre de la región de region_id
 * ============================================================================
 */

/**
 * Las columnas de la tabla salen del modelo (`src/db/schema/usuarios.ts`), que es
 * la única fuente de verdad: no se repiten acá para que no puedan quedar
 * desincronizadas.
 */
export type Usuario = typeof usuarios.$inferSelect

/** v_usuarios = usuarios + el alcance resuelto a nombres legibles. */
export interface VUsuario extends Usuario {
  empresa_nombre: string | null
  organismo_nombre: string | null
  region: string | null
}

/**
 * Lista para la pantalla de administración. Lee de v_usuarios para que la
 * tabla siga mostrando el nombre de la región (y no su id).
 */
export async function listUsuarios(db: Pool | PoolClient): Promise<VUsuario[]> {
  const { rows } = await db.query('SELECT * FROM v_usuarios ORDER BY nombre')
  return rows
}

export async function getUsuarioPorId(db: Pool | PoolClient, id: number): Promise<VUsuario | null> {
  const { rows } = await db.query('SELECT * FROM v_usuarios WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function getUsuarioRolEmail(db: Pool | PoolClient, id: number) {
  const { rows } = await db.query('SELECT rol, email FROM usuarios WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function contarAdmins(db: Pool | PoolClient): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin'`)
  return rows[0].n
}

export interface DatosUsuarioNuevo {
  sub: string
  nombre: string
  email: string
  rol: RolUsuario
  empresaId: number | null
  organismoId: number | null
  /** Id del catálogo `regiones`, no el nombre. */
  regionId: number | null
  creadoPorSub: string
}

export async function crearUsuario(db: Pool | PoolClient, datos: DatosUsuarioNuevo) {
  const { rows } = await db.query(
    `INSERT INTO usuarios (cognito_sub, nombre, email, rol, empresa_id, organismo_id, region_id,
                           created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     RETURNING *`,
    [
      datos.sub, datos.nombre, datos.email, datos.rol,
      datos.empresaId, datos.organismoId, datos.regionId, datos.creadoPorSub,
    ],
  )
  return rows[0]
}

export interface DatosUsuarioActualizado {
  nombre: string | null
  rol: RolUsuario
  empresaId: number | null
  organismoId: number | null
  /** Id del catálogo `regiones`, no el nombre. */
  regionId: number | null
  actualizadoPorSub: string
}

export async function actualizarUsuario(db: Pool | PoolClient, id: number, datos: DatosUsuarioActualizado) {
  const { rows } = await db.query(
    `UPDATE usuarios
        SET nombre = COALESCE($1, nombre),
            rol = $2,
            empresa_id = $3,
            organismo_id = $4,
            region_id = $5,
            updated_by = $6
      WHERE id = $7
      RETURNING *`,
    [
      datos.nombre, datos.rol,
      datos.empresaId, datos.organismoId, datos.regionId,
      datos.actualizadoPorSub, id,
    ],
  )
  return rows[0]
}

export async function eliminarUsuario(db: Pool | PoolClient, id: number) {
  await db.query('DELETE FROM usuarios WHERE id = $1', [id])
}
