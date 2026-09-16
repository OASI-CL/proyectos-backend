import type { Pool, PoolClient } from 'pg'
import type { UsuarioAutenticado } from '../middleware/auth'
import { WhereBuilder, scopePermisos } from '../middleware/scope'

/** Verifica que el permiso exista y esté dentro del scope del usuario. */
export async function permisoVisible(
  db: Pool | PoolClient,
  permisoId: number,
  user: UsuarioAutenticado,
): Promise<boolean> {
  const wb = new WhereBuilder()
  scopePermisos(wb, user)
  wb.add((i) => `id = $${i}`, permisoId)
  const { rows } = await db.query(`SELECT id FROM v_permisos ${wb.where}`, wb.params)
  return rows.length > 0
}

export async function listAdjuntosPorPermiso(db: Pool | PoolClient, permisoId: number) {
  const { rows } = await db.query(
    `SELECT a.*, u.nombre AS subido_por_nombre
       FROM adjuntos a
       LEFT JOIN usuarios u ON u.cognito_sub = a.uploaded_by
      WHERE a.permiso_id = $1
      ORDER BY a.created_at DESC`,
    [permisoId],
  )
  return rows
}

export async function crearAdjunto(
  db: Pool | PoolClient,
  permisoId: number,
  nombreArchivo: string,
  s3Key: string,
  contentType: string | null,
  sizeBytes: number | null,
  uploadedBy: string,
) {
  const { rows } = await db.query(
    `INSERT INTO adjuntos (permiso_id, nombre_archivo, s3_key, content_type, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [permisoId, nombreArchivo, s3Key, contentType, sizeBytes, uploadedBy],
  )
  return rows[0]
}

export async function getAdjuntoPorId(db: Pool | PoolClient, id: number) {
  const { rows } = await db.query('SELECT * FROM adjuntos WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function eliminarAdjunto(db: Pool | PoolClient, id: number) {
  await db.query('DELETE FROM adjuntos WHERE id = $1', [id])
}
