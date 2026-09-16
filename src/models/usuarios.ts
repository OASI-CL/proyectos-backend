import type { Pool, PoolClient } from 'pg'
import type { RolUsuario } from '../shared/types'

export async function listUsuarios(db: Pool | PoolClient) {
  const { rows } = await db.query(
    `SELECT u.*, e.nombre AS empresa_nombre, o.nombre AS organismo_nombre
       FROM usuarios u
       LEFT JOIN empresas e ON e.id = u.empresa_id
       LEFT JOIN organismos o ON o.id = u.organismo_id
      ORDER BY u.nombre`,
  )
  return rows
}

export async function getUsuarioPorId(db: Pool | PoolClient, id: number) {
  const { rows } = await db.query('SELECT * FROM usuarios WHERE id = $1', [id])
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
  region: string | null
  creadoPorSub: string
}

export async function crearUsuario(db: Pool | PoolClient, datos: DatosUsuarioNuevo) {
  const { rows } = await db.query(
    `INSERT INTO usuarios (cognito_sub, nombre, email, rol, empresa_id, organismo_id, region,
                           created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     RETURNING *`,
    [
      datos.sub, datos.nombre, datos.email, datos.rol,
      datos.empresaId, datos.organismoId, datos.region, datos.creadoPorSub,
    ],
  )
  return rows[0]
}

export interface DatosUsuarioActualizado {
  nombre: string | null
  rol: RolUsuario
  empresaId: number | null
  organismoId: number | null
  region: string | null
  actualizadoPorSub: string
}

export async function actualizarUsuario(db: Pool | PoolClient, id: number, datos: DatosUsuarioActualizado) {
  const { rows } = await db.query(
    `UPDATE usuarios
        SET nombre = COALESCE($1, nombre),
            rol = $2,
            empresa_id = $3,
            organismo_id = $4,
            region = $5,
            updated_by = $6
      WHERE id = $7
      RETURNING *`,
    [
      datos.nombre, datos.rol,
      datos.empresaId, datos.organismoId, datos.region,
      datos.actualizadoPorSub, id,
    ],
  )
  return rows[0]
}

export async function eliminarUsuario(db: Pool | PoolClient, id: number) {
  await db.query('DELETE FROM usuarios WHERE id = $1', [id])
}
