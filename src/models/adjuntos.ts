import type { Pool, PoolClient } from 'pg'
import type { UsuarioAutenticado } from '../middleware/auth'
import { WhereBuilder, scopePermisos } from '../middleware/scope'

/**
 * ============================================================================
 * ADJUNTO — metadata de un archivo de un permiso.
 *
 * El archivo en sí vive en S3; acá solo va la metadata. Verificado contra
 * `\d adjuntos`.
 * ============================================================================
 */

export interface Adjunto {
  id: number
  /** FK a permisos. ON DELETE CASCADE: borrar el permiso borra sus adjuntos. */
  permiso_id: number
  /** Nombre original del archivo, el que ve y descarga el usuario. */
  nombre_archivo: string
  /** Ruta del objeto en S3. Es la ubicación real del archivo. */
  s3_key: string
  content_type: string | null
  size_bytes: number | null
  /** cognito_sub de quien lo subió (no el id de usuarios). */
  uploaded_by: string
  created_at: string
}

/** Lo que agrega listAdjuntosPorPermiso sobre la tabla (join con usuarios). */
export interface AdjuntoConUsuario extends Adjunto {
  subido_por_nombre: string | null
}

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
