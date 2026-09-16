import { Router } from 'express'
import { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { pool } from '../db/client'
import { puedeEscribir } from '../middleware/scope'
import {
  permisoVisible,
  listAdjuntosPorPermiso,
  crearAdjunto,
  getAdjuntoPorId,
  eliminarAdjunto,
} from '../models/adjuntos'

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

/**
 * GET /adjuntos/permiso/:permisoId — lista los adjuntos de un permiso, cada
 * uno con una URL de descarga prefirmada (válida 5 minutos).
 */
router.get('/permiso/:permisoId', async (req, res, next) => {
  try {
    const permisoId = Number(req.params.permisoId)
    if (!(await permisoVisible(pool, permisoId, req.user!))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const rows = await listAdjuntosPorPermiso(pool, permisoId)

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
    if (!(await permisoVisible(pool, permisoId, req.user!))) {
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
    if (!(await permisoVisible(pool, permisoId, req.user!))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const { nombre_archivo, s3_key, content_type, size_bytes } = req.body ?? {}
    if (!nombre_archivo || !s3_key) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'Faltan datos del archivo' })
    }

    const adjunto = await crearAdjunto(
      pool,
      permisoId,
      nombre_archivo,
      s3_key,
      content_type ?? null,
      size_bytes ?? null,
      req.user!.sub,
    )

    res.status(201).json(adjunto)
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

    const adjunto = await getAdjuntoPorId(pool, Number(req.params.id))
    if (!adjunto) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Adjunto no encontrado' })
    }
    if (!(await permisoVisible(pool, adjunto.permiso_id, req.user!))) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Adjunto no encontrado' })
    }

    if (s3Configurado()) {
      await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: adjunto.s3_key }))
    }
    await eliminarAdjunto(pool, Number(req.params.id))

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
