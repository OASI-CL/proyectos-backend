import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos, puedeEscribir, requiereAprobacion } from '../middleware/scope'
import {
  ApprovalError,
  crearSolicitudEdicion,
  filtrarCamposEditables,
} from '../services/approvals'
import {
  filtrosPermisos,
  COLUMNAS_ORDENABLES_PERMISOS,
  countPermisos,
  listPermisosPaginado,
  listPermisosParaExport,
  getPermisoPorId,
  permisoVisibleId,
  listHistorialPermiso,
  getPermisoDirectoConScope,
  aplicarCambiosPermiso,
} from '../models/permisos'

const router = Router()

/**
 * GET /permisos — lista paginada con filtros.
 */
router.get('/', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    filtrosPermisos(wb, req.query as Record<string, unknown>)

    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50))

    const sortBy = COLUMNAS_ORDENABLES_PERMISOS.has(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'dias_tramitacion'
    const sortDir = String(req.query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const total = await countPermisos(pool, wb)
    const rows = await listPermisosPaginado(pool, wb, sortBy, sortDir, pageSize, (page - 1) * pageSize)

    res.json({ data: rows, total, page, pageSize })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /permisos/export — mismos filtros, devuelve CSV (se abre en Excel).
 * Va antes de /:id para que 'export' no se interprete como un id.
 */
router.get('/export', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    filtrosPermisos(wb, req.query as Record<string, unknown>)

    const rows = await listPermisosParaExport(pool, wb)

    const columnas = rows.length > 0 ? Object.keys(rows[0]) : []
    const escapar = (v: unknown) => {
      if (v === null || v === undefined) return ''
      const s = String(v).replace(/"/g, '""')
      return /[",;\n]/.test(s) ? `"${s}"` : s
    }

    // BOM para que Excel reconozca UTF-8, y ; como separador (locale es-CL)
    const csv = [
      columnas.join(';'),
      ...rows.map((r) => columnas.map((c) => escapar(r[c])).join(';')),
    ].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="permisos.csv"')
    res.send('﻿' + csv)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /permisos/:id — detalle.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    const permiso = await getPermisoPorId(pool, wb, Number(req.params.id))

    // 404 y no 403: no revelamos que el permiso existe si no es de su scope.
    if (!permiso) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }
    res.json(permiso)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /permisos/:id/historial — historial de cambios con nombre de usuario.
 */
router.get('/:id/historial', async (req, res, next) => {
  try {
    // Chequeo de scope primero
    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    const id = Number(req.params.id)
    const visible = await permisoVisibleId(pool, wb, id)
    if (!visible) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const rows = await listHistorialPermiso(pool, id)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /permisos/:id
 *
 * OASI/admin write straight to the table. empresa and organismo do not: their
 * edit is queued as a change request for OASI to approve (see
 * services/approvals.ts) and this responds 202 with the request.
 */
router.patch('/:id', async (req, res, next) => {
  const user = req.user!
  if (!puedeEscribir(user)) {
    return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
  }

  const id = Number(req.params.id)

  // --- Roles that need approval: queue instead of writing -------------------
  if (requiereAprobacion(user)) {
    try {
      // Scope check first: you can only propose changes on what you can see.
      const wbScope = new WhereBuilder()
      scopePermisos(wbScope, user)
      const visible = await permisoVisibleId(pool, wbScope, id)
      if (!visible) {
        return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
      }

      const cambiosPropuestos = filtrarCamposEditables('permiso', req.body ?? {})
      if (Object.keys(cambiosPropuestos).length === 0) {
        return res
          .status(400)
          .json({ error: 'sin_cambios', message: 'No se envió ningún campo editable' })
      }

      const solicitud = await crearSolicitudEdicion(
        'permiso',
        id,
        cambiosPropuestos,
        user,
        typeof req.body?.comentario === 'string' ? req.body.comentario : undefined,
      )

      return res.status(202).json({
        estado: 'pendiente_aprobacion',
        message: 'Tus cambios quedaron enviados para revisión de OASI.',
        solicitud,
      })
    } catch (err) {
      if (err instanceof ApprovalError) {
        return res.status(err.status).json({ error: err.code, message: err.message })
      }
      return next(err)
    }
  }

  // --- OASI / admin: direct write -------------------------------------------
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const wb = new WhereBuilder()
    scopePermisos(wb, user)
    const anterior = await getPermisoDirectoConScope(client, wb, id)

    if (!anterior) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const cambios = filtrarCamposEditables('permiso', req.body ?? {})

    if (Object.keys(cambios).length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'sin_cambios', message: 'No se envió ningún campo editable' })
    }

    const actualizado = await aplicarCambiosPermiso(client, id, anterior, cambios, user.sub)

    await client.query('COMMIT')
    res.json(actualizado)
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

export default router
