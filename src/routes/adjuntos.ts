import { Router } from 'express'
import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos, puedeEscribir } from '../middleware/scope'

const router = Router()

const BUCKET = process.env.S3_BUCKET_ADJUNTOS

/** ¿Está configurado S3? Si no, las rutas responden 503 con un mensaje claro. */
function s3Configurado(): boolean {
  return Boolean(BUCKET)
}

// El cliente se crea recién cuando hace falta: si se construyera al importar
// el módulo, el server no arranca cuando AWS_REGION está vacío (que es el caso
// mientras S3 no esté configurado).
let s3Cache: S3Client | null = null
function getS3(): S3Client {
  if (!s3Cache) {
    s3Cache = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
  }
  return s3Cache
}

/** Verifica que el permiso exista y esté dentro del scope del usuario. */
async function permisoVisible(permisoId: number, user: Express.Request['user']): Promise<boolean> {
  const wb = new WhereBuilder()
  scopePermisos(wb, user!)
  wb.add((i) => `id = $${i}`, permisoId)
  const { rows } = await pool.query(`SELECT id FROM v_permisos ${wb.where}`, wb.params)
  return rows.length > 0
}

/**
 * GET /adjuntos/permiso/:permisoId — lista los adjuntos de un permiso, cada
 * uno con una URL de descarga prefirmada (válida 5 minutos).
 */
router.get('/permiso/:permisoId', async (req, res, next) => {
  try {
    const permisoId = Number(req.params.permisoId)
    if (!(await permisoVisible(permisoId, req.user))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const { rows } = await pool.query(
      `SELECT a.*, u.nombre AS subido_por_nombre
         FROM adjuntos a
         LEFT JOIN usuarios u ON u.cognito_sub = a.uploaded_by
        WHERE a.permiso_id = $1
        ORDER BY a.created_at DESC`,
      [permisoId],
    )

    if (!s3Configurado()) {
      return res.json(rows.map((r) => ({ ...r, url: null })))
    }

    const conUrl = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        url: await getSignedUrl(getS3(), new GetObjectCommand({ Bucket: BUCKET, Key: r.s3_key }), {
          expiresIn: 300,
        }),
      })),
    )
    res.json(conUrl)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /adjuntos/permiso/:permisoId/url-subida — devuelve una URL prefirmada
 * para que el navegador suba el archivo directo a S3 (sin pasar por Lambda).
 */
router.post('/permiso/:permisoId/url-subida', async (req, res, next) => {
  try {
    if (!puedeEscribir(req.user!)) {
      return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
    }
    if (!s3Configurado()) {
      return res.status(503).json({
        error: 's3_no_configurado',
        message: 'Falta configurar S3_BUCKET_ADJUNTOS en el backend',
      })
    }

    const permisoId = Number(req.params.permisoId)
    if (!(await permisoVisible(permisoId, req.user))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const { nombre_archivo, content_type } = req.body ?? {}
    if (!nombre_archivo) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'Falta el nombre del archivo' })
    }

    // Prefijo con el id del permiso y un timestamp para evitar colisiones.
    const limpio = String(nombre_archivo).replace(/[^\w.\-]/g, '_')
    const s3Key = `permisos/${permisoId}/${Date.now()}-${limpio}`

    const url = await getSignedUrl(
      getS3(),
      new PutObjectCommand({ Bucket: BUCKET, Key: s3Key, ContentType: content_type ?? undefined }),
      { expiresIn: 300 },
    )

    res.json({ url, s3_key: s3Key })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /adjuntos/permiso/:permisoId — registra en la BD un archivo ya subido
 * a S3 con la URL prefirmada del paso anterior.
 */
router.post('/permiso/:permisoId', async (req, res, next) => {
  try {
    if (!puedeEscribir(req.user!)) {
      return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
    }

    const permisoId = Number(req.params.permisoId)
    if (!(await permisoVisible(permisoId, req.user))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const { nombre_archivo, s3_key, content_type, size_bytes } = req.body ?? {}
    if (!nombre_archivo || !s3_key) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'Faltan datos del archivo' })
    }

    const { rows } = await pool.query(
      `INSERT INTO adjuntos (permiso_id, nombre_archivo, s3_key, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [permisoId, nombre_archivo, s3_key, content_type ?? null, size_bytes ?? null, req.user!.sub],
    )

    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /adjuntos/:id — borra el registro y el objeto en S3.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!puedeEscribir(req.user!)) {
      return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
    }

    const { rows } = await pool.query('SELECT * FROM adjuntos WHERE id = $1', [Number(req.params.id)])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Adjunto no encontrado' })
    }
    if (!(await permisoVisible(rows[0].permiso_id, req.user))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Adjunto no encontrado' })
    }

    if (s3Configurado()) {
      await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rows[0].s3_key }))
    }
    await pool.query('DELETE FROM adjuntos WHERE id = $1', [Number(req.params.id)])

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
