import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopeProyectos, scopePermisos, puedeEscribir } from '../middleware/scope'

const router = Router()

function filtrosProyectos(wb: WhereBuilder, q: Record<string, unknown>) {
  const s = (k: string) => (typeof q[k] === 'string' && q[k] !== '' ? String(q[k]) : undefined)
  const n = (k: string) => (s(k) !== undefined && !Number.isNaN(Number(s(k))) ? Number(s(k)) : undefined)

  if (n('empresa_id') !== undefined) wb.add((i) => `empresa_id = $${i}`, n('empresa_id'))
  if (s('sector')) wb.add((i) => `sector = $${i}`, s('sector'))
  if (s('region')) wb.add((i) => `region = $${i}`, s('region'))
  if (s('etapa')) wb.add((i) => `etapa = $${i}`, s('etapa'))
  if (s('id_excel')) wb.add((i) => `id_excel = $${i}`, s('id_excel'))
  if (s('con_permisos_6meses') === 'true') wb.addRaw('permisos_6meses > 0')
  if (s('sin_pendientes') === 'true') wb.addRaw('sin_pendientes IS TRUE')
  if (s('sin_pendientes') === 'false') wb.addRaw('sin_pendientes IS FALSE')
  if (s('q')) wb.add((i) => `nombre ILIKE '%' || $${i} || '%'`, s('q'))

  return wb
}

const COLUMNAS_ORDENABLES = new Set([
  'id', 'id_excel', 'nombre', 'empresa_nombre', 'sector', 'region', 'etapa',
  'inversion_mmusd', 'total_permisos', 'permisos_pendientes', 'permisos_6meses',
])

/**
 * GET /proyectos — lista paginada con filtros.
 */
router.get('/', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopeProyectos(wb, req.user!)
    filtrosProyectos(wb, req.query as Record<string, unknown>)

    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 50))

    const sortBy = COLUMNAS_ORDENABLES.has(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'permisos_pendientes'
    const sortDir = String(req.query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const total = await pool.query(
      `SELECT count(*)::int AS total FROM v_proyectos ${wb.where}`,
      wb.params,
    )

    const limitIdx = wb.push(pageSize)
    const offsetIdx = wb.push((page - 1) * pageSize)

    const { rows } = await pool.query(
      `SELECT * FROM v_proyectos ${wb.where}
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
 * GET /proyectos/:id — detalle del proyecto.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopeProyectos(wb, req.user!)
    wb.add((i) => `id = $${i}`, Number(req.params.id))

    const { rows } = await pool.query(`SELECT * FROM v_proyectos ${wb.where}`, wb.params)
    if (rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Proyecto no encontrado' })
    }
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

/**
 * GET /proyectos/:id/permisos — permisos de ese proyecto (con scope propio,
 * así un organismo_lector solo ve los suyos dentro del proyecto).
 */
router.get('/:id/permisos', async (req, res, next) => {
  try {
    const wb = new WhereBuilder()
    scopePermisos(wb, req.user!)
    wb.add((i) => `proyecto_id = $${i}`, Number(req.params.id))

    const { rows } = await pool.query(
      `SELECT * FROM v_permisos ${wb.where} ORDER BY dias_tramitacion DESC NULLS LAST`,
      wb.params,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /proyectos — crear. Un proyecto creado desde la app queda con
 * id_excel NULL. Si lo crea una empresa, queda forzado a su propia empresa
 * y en estado 'en_revision' para que OASI lo valide.
 */
router.post('/', async (req, res, next) => {
  const user = req.user!
  if (!puedeEscribir(user)) {
    return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
  }

  try {
    const b = req.body ?? {}
    if (!b.nombre) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'El nombre es obligatorio' })
    }

    const empresaId = user.rol === 'empresa' ? user.empresaId : b.empresa_id
    if (!empresaId) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'Falta la empresa' })
    }

    const estadoValidacion = user.rol === 'empresa' ? 'en_revision' : 'validado'

    const { rows } = await pool.query(
      `INSERT INTO proyectos (
         nombre, titular, empresa_id, region, sector, inversion_mmusd,
         empleo_construccion, empleo_operacion, etapa, estado_ambiental,
         fecha_inicio_construccion, fecha_inicio_operacion, observaciones_oasi,
         estado_validacion, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING *`,
      [
        b.nombre, b.titular ?? null, empresaId, b.region ?? null, b.sector ?? null,
        b.inversion_mmusd ?? null, b.empleo_construccion ?? null, b.empleo_operacion ?? null,
        b.etapa ?? null, b.estado_ambiental ?? null, b.fecha_inicio_construccion || null,
        b.fecha_inicio_operacion || null, b.observaciones_oasi ?? null,
        estadoValidacion, user.sub,
      ],
    )

    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

/**
 * POST /proyectos/:id/permisos — agregar un permiso a un proyecto.
 */
router.post('/:id/permisos', async (req, res, next) => {
  const user = req.user!
  if (!puedeEscribir(user)) {
    return res.status(403).json({ error: 'sin_permiso', message: 'Tu rol es de solo lectura' })
  }

  try {
    const proyectoId = Number(req.params.id)

    // El proyecto tiene que existir dentro del scope del usuario
    const wb = new WhereBuilder()
    scopeProyectos(wb, user)
    wb.add((i) => `id = $${i}`, proyectoId)
    const proyecto = await pool.query(`SELECT id FROM v_proyectos ${wb.where}`, wb.params)
    if (proyecto.rows.length === 0) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Proyecto no encontrado' })
    }

    const b = req.body ?? {}
    if (!b.nombre || !b.organismo_id) {
      return res.status(400).json({
        error: 'datos_invalidos',
        message: 'El nombre y el organismo son obligatorios',
      })
    }

    const estadoValidacion = user.rol === 'empresa' ? 'en_revision' : 'validado'

    const { rows } = await pool.query(
      `INSERT INTO permisos (
         proyecto_id, organismo_id, nombre, nombre_estandar, tipo_permiso,
         n_expediente, critico, que_habilita, habilitante_construccion, estado,
         fecha_ingreso, fecha_resolucion_estimada, observaciones,
         estado_validacion, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING *`,
      [
        proyectoId, b.organismo_id, b.nombre, b.nombre_estandar ?? null,
        b.tipo_permiso ?? null, b.n_expediente ?? null, b.critico ?? false,
        b.que_habilita ?? null, b.habilitante_construccion ?? false,
        b.estado ?? 'Pendiente', b.fecha_ingreso || null,
        b.fecha_resolucion_estimada || null, b.observaciones ?? null,
        estadoValidacion, user.sub,
      ],
    )

    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

export default router
