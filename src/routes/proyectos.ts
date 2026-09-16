import { Router } from 'express'
import { pool } from '../db/client'
import {
  WhereBuilder,
  scopeProyectos,
  scopePermisos,
  puedeEscribir,
  puedeCrearProyectos,
  requiereAprobacion,
} from '../middleware/scope'
import { crearSolicitudCreacion } from '../services/approvals'
import {
  filtrosProyectos,
  COLUMNAS_ORDENABLES_PROYECTOS,
  countProyectos,
  listProyectosPaginado,
  getProyectoPorId,
  listPermisosDeProyecto,
  proyectoVisibleId,
  crearProyecto,
  crearPermisoDeProyecto,
} from '../models/proyectos'

const router = Router()

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

    const sortBy = COLUMNAS_ORDENABLES_PROYECTOS.has(String(req.query.sortBy))
      ? String(req.query.sortBy)
      : 'permisos_pendientes'
    const sortDir = String(req.query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const total = await countProyectos(pool, wb)
    const rows = await listProyectosPaginado(pool, wb, sortBy, sortDir, pageSize, (page - 1) * pageSize)

    res.json({ data: rows, total, page, pageSize })
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
    const proyecto = await getProyectoPorId(pool, wb, Number(req.params.id))
    if (!proyecto) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Proyecto no encontrado' })
    }
    res.json(proyecto)
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
    const rows = await listPermisosDeProyecto(pool, wb, Number(req.params.id))
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
  if (!puedeCrearProyectos(user)) {
    return res.status(403).json({
      error: 'sin_permiso',
      message:
        user.rol === 'organismo'
          ? 'Un organismo puede editar sus permisos, pero no crear proyectos.'
          : 'Tu rol es de solo lectura',
    })
  }

  const client = await pool.connect()
  try {
    const b = req.body ?? {}
    if (!b.nombre) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'El nombre es obligatorio' })
    }

    const empresaId = user.rol === 'empresa' ? user.empresaId : b.empresa_id
    if (!empresaId) {
      return res.status(400).json({ error: 'datos_invalidos', message: 'Falta la empresa' })
    }

    const necesitaAprobacion = requiereAprobacion(user)
    const estadoValidacion = necesitaAprobacion ? 'en_revision' : 'validado'

    await client.query('BEGIN')

    const proyecto = await crearProyecto(client, {
      nombre: b.nombre,
      titular: b.titular,
      empresaId,
      regionId: b.region_id,
      sectorId: b.sector_id,
      etapaId: b.etapa_id,
      inversionMmusd: b.inversion_mmusd,
      empleoConstruccion: b.empleo_construccion,
      empleoOperacion: b.empleo_operacion,
      estadoAmbiental: b.estado_ambiental,
      fechaInicioConstruccion: b.fecha_inicio_construccion,
      fechaInicioOperacion: b.fecha_inicio_operacion,
      observacionesOasi: b.observaciones_oasi,
      estadoValidacion,
      creadoPorSub: user.sub,
    })

    // Queue it for OASI so it shows up in the same approvals screen as edits.
    if (necesitaAprobacion) {
      await crearSolicitudCreacion(client, 'proyecto', proyecto.id, user)
    }

    await client.query('COMMIT')

    res.status(201).json({
      ...proyecto,
      pendienteAprobacion: necesitaAprobacion,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
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
    const existe = await proyectoVisibleId(pool, wb, proyectoId)
    if (!existe) {
      return res.status(404).json({ error: 'no_encontrado', message: 'Proyecto no encontrado' })
    }

    const b = req.body ?? {}
    if (!b.nombre || !b.organismo_id) {
      return res.status(400).json({
        error: 'datos_invalidos',
        message: 'El nombre y el organismo son obligatorios',
      })
    }

    // An 'organismo' can only add permits that belong to its own agency.
    if (user.rol === 'organismo' && Number(b.organismo_id) !== user.organismoId) {
      return res.status(403).json({
        error: 'sin_permiso',
        message: 'Solo podés agregar permisos de tu propio organismo.',
      })
    }

    const necesitaAprobacion = requiereAprobacion(user)
    const estadoValidacion = necesitaAprobacion ? 'en_revision' : 'validado'

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const permiso = await crearPermisoDeProyecto(client, {
        proyectoId,
        organismoId: b.organismo_id,
        nombre: b.nombre,
        nombreEstandar: b.nombre_estandar,
        tipoPermiso: b.tipo_permiso,
        nExpediente: b.n_expediente,
        critico: b.critico,
        queHabilita: b.que_habilita,
        habilitanteConstruccion: b.habilitante_construccion,
        estadoId: b.estado_id,
        fechaIngreso: b.fecha_ingreso,
        fechaResolucionEstimada: b.fecha_resolucion_estimada,
        observaciones: b.observaciones,
        estadoValidacion,
        creadoPorSub: user.sub,
      })

      if (necesitaAprobacion) {
        await crearSolicitudCreacion(client, 'permiso', permiso.id, user)
      }

      await client.query('COMMIT')
      res.status(201).json({ ...permiso, pendienteAprobacion: necesitaAprobacion })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
})

export default router
