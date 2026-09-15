import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos, puedeEscribir } from '../middleware/scope'
import { registrarCambios } from '../services/historial'

const router = Router()

/**
 * Traduce los query params de filtro a condiciones SQL sobre v_permisos.
 */
function filtrosPermisos(wb: WhereBuilder, q: Record<string, unknown>) {
  const s = (k: string) => (typeof q[k] === 'string' && q[k] !== '' ? String(q[k]) : undefined)
  const n = (k: string) => (s(k) !== undefined && !Number.isNaN(Number(s(k))) ? Number(s(k)) : undefined)

  if (n('organismo_id') !== undefined) wb.add((i) => `organismo_id = $${i}`, n('organismo_id'))
  if (n('ministerio_id') !== undefined) wb.add((i) => `ministerio_id = $${i}`, n('ministerio_id'))
  if (n('empresa_id') !== undefined) wb.add((i) => `empresa_id = $${i}`, n('empresa_id'))
  if (n('proyecto_id') !== undefined) wb.add((i) => `proyecto_id = $${i}`, n('proyecto_id'))
  if (s('estado')) wb.add((i) => `estado = $${i}`, s('estado'))
  if (s('region')) wb.add((i) => `region = $${i}`, s('region'))
  if (s('sector')) wb.add((i) => `sector = $${i}`, s('sector'))
  if (s('id_excel')) wb.add((i) => `id_excel = $${i}`, s('id_excel'))

  if (s('critico') === 'true') wb.addRaw('critico IS TRUE')
  if (s('critico') === 'false') wb.addRaw('critico IS FALSE')
  if (s('habilitante') === 'true') wb.addRaw('habilitante_construccion IS TRUE')
  if (s('habilitante') === 'false') wb.addRaw('habilitante_construccion IS FALSE')

  // Tramo de tramitación
  if (s('tramo') === 'menos_3') wb.addRaw('menos_3_meses IS TRUE')
  if (s('tramo') === 'entre_3_6') wb.addRaw('entre_3_y_6_meses IS TRUE')
  if (s('tramo') === 'mas_6') wb.addRaw('supera_6_meses IS TRUE')

  if (s('semaforo')) wb.add((i) => `semaforo = $${i}`, s('semaforo'))

  if (s('fecha_ingreso_desde')) wb.add((i) => `fecha_ingreso >= $${i}`, s('fecha_ingreso_desde'))
  if (s('fecha_ingreso_hasta')) wb.add((i) => `fecha_ingreso <= $${i}`, s('fecha_ingreso_hasta'))

  // Búsqueda libre por nombre de permiso o de proyecto
  if (s('q')) {
    wb.add((i) => `(nombre ILIKE '%' || $${i} || '%' OR proyecto_nombre ILIKE '%' || $${i} || '%')`, s('q'))
  }

  return wb
}

const COLUMNAS_ORDENABLES = new Set([
  'id', 'id_excel', 'nombre', 'estado', 'fecha_ingreso', 'dias_tramitacion',
  'organismo_nombre', 'proyecto_nombre', 'empresa_nombre', 'semaforo',
])

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

    const sortBy = COLUMNAS_ORDENABLES.has(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'dias_tramitacion'
    const sortDir = String(req.query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const total = await pool.query(
      `SELECT count(*)::int AS total FROM v_permisos ${wb.where}`,
      wb.params,
    )

    const limitIdx = wb.push(pageSize)
    const offsetIdx = wb.push((page - 1) * pageSize)

    const { rows } = await pool.query(
      `SELECT * FROM v_permisos ${wb.where}
       ORDER BY ${sortBy} ${sortDir} NULLS LAST, id ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      wb.params,
    )

    res.json({ data: rows, total: total.rows[0].total, page, pageSize })
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

    const { rows } = await pool.query(
      `SELECT id_excel, nombre, organismo_nombre, ministerio_nombre, proyecto_id_excel,
              proyecto_nombre, empresa_nombre, region, sector, estado, fecha_ingreso,
              fecha_resolucion, dias_tramitacion, semaforo, critico, habilitante_construccion,
              n_expediente, observaciones
         FROM v_permisos ${wb.where}
        ORDER BY dias_tramitacion DESC NULLS LAST`,
      wb.params,
    )

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
    wb.add((i) => `id = $${i}`, Number(req.params.id))

    const { rows } = await pool.query(`SELECT * FROM v_permisos ${wb.where}`, wb.params)

    // 404 y no 403: no revelamos que el permiso existe si no es de su scope.
    if (rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }
    res.json(rows[0])
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
    wb.add((i) => `id = $${i}`, Number(req.params.id))
    const permiso = await pool.query(`SELECT id FROM v_permisos ${wb.where}`, wb.params)
    if (permiso.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const { rows } = await pool.query(
      `SELECT * FROM v_historial WHERE entidad = 'permiso' AND entidad_id = $1`,
      [Number(req.params.id)],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

const CAMPOS_EDITABLES = [
  'nombre', 'nombre_estandar', 'tipo_permiso', 'n_expediente', 'critico',
  'que_habilita', 'habilitante_construccion', 'estado', 'fecha_ingreso',
  'fecha_resolucion_estimada', 'fecha_resolucion', 'tipo_resolucion',
  'hito_tramitacion', 'incluido_catastro_hacienda', 'n_catastro', 'observaciones',
]

/**
 * PATCH /permisos/:id — edita y registra el diff en historial, todo en una
 * sola transacción.
 */
router.patch('/:id', async (req, res, next) => {
  const user = req.user!
  if (!puedeEscribir(user)) {
    return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
  }

  const id = Number(req.params.id)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Traemos el registro anterior con el scope aplicado
    const wb = new WhereBuilder()
    scopePermisos(wb, user)
    wb.add((i) => `id = $${i}`, id)
    const previo = await client.query(
      `SELECT p.* FROM permisos p
        WHERE p.id IN (SELECT id FROM v_permisos ${wb.where})`,
      wb.params,
    )

    if (previo.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'no_encontrado', message: 'Permiso no encontrado' })
    }

    const anterior = previo.rows[0]
    const cambios: Record<string, unknown> = {}
    for (const campo of CAMPOS_EDITABLES) {
      if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
        cambios[campo] = req.body[campo] === '' ? null : req.body[campo]
      }
    }

    if (Object.keys(cambios).length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'sin_cambios', message: 'No se envió ningún campo editable' })
    }

    const sets = Object.keys(cambios).map((campo, i) => `${campo} = $${i + 1}`)
    const valores = Object.values(cambios)
    valores.push(user.sub) // updated_by
    valores.push(id)

    const actualizado = await client.query(
      `UPDATE permisos SET ${sets.join(', ')}, updated_by = $${valores.length - 1}
         WHERE id = $${valores.length} RETURNING *`,
      valores,
    )

    await registrarCambios(client, 'permiso', id, anterior, cambios, user.sub)
    await client.query('COMMIT')

    res.json(actualizado.rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

export default router
