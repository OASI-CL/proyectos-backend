import { Router } from 'express'
import { pool } from '../db/client'
import { WhereBuilder, scopePermisos, scopeProyectos } from '../middleware/scope'

const router = Router()

/**
 * GET /dashboard — todo lo que necesita la home, ya scopeado por rol.
 * Una empresa ve el dashboard de sus propios proyectos.
 */
router.get('/', async (req, res, next) => {
  try {
    const user = req.user!

    // --- KPIs sobre permisos ---
    const wbPermisos = new WhereBuilder()
    scopePermisos(wbPermisos, user)

    const kpis = await pool.query(
      `SELECT
         count(*)::int                                                    AS total_permisos,
         count(*) FILTER (WHERE estado = 'Pendiente')::int                AS pendientes,
         count(*) FILTER (WHERE estado = 'Pendiente' AND supera_6_meses)::int AS pendientes_6meses,
         count(*) FILTER (WHERE estado = 'Resuelto')::int                 AS resueltos,
         count(*) FILTER (WHERE estado = 'Pendiente' AND critico)::int    AS criticos_pendientes,
         round(avg(dias_tramitacion) FILTER (WHERE estado = 'Pendiente'))::int AS promedio_dias_pendientes
       FROM v_permisos ${wbPermisos.where}`,
      wbPermisos.params,
    )

    // --- Proyectos + inversión bloqueada ---
    const wbProyectos = new WhereBuilder()
    scopeProyectos(wbProyectos, user)

    const proyectos = await pool.query(
      `SELECT
         count(*)::int                                                  AS total_proyectos,
         count(*) FILTER (WHERE permisos_pendientes > 0)::int            AS proyectos_con_pendientes,
         COALESCE(sum(inversion_mmusd) FILTER (WHERE permisos_pendientes > 0), 0)::numeric AS inversion_bloqueada_mmusd
       FROM v_proyectos ${wbProyectos.where}`,
      wbProyectos.params,
    )

    // --- Barras: pendientes por organismo ---
    const wbOrg = new WhereBuilder()
    scopePermisos(wbOrg, user)
    wbOrg.addRaw(`estado = 'Pendiente'`)

    const porOrganismo = await pool.query(
      `SELECT organismo_id, organismo_nombre, ministerio_nombre,
              count(*)::int                                  AS pendientes,
              count(*) FILTER (WHERE supera_6_meses)::int     AS supera_6_meses,
              round(avg(dias_tramitacion))::int               AS promedio_dias
         FROM v_permisos ${wbOrg.where}
        GROUP BY organismo_id, organismo_nombre, ministerio_nombre
        ORDER BY pendientes DESC`,
      wbOrg.params,
    )

    // --- Línea: evolución a través de los comités ---
    const evolucion = await pool.query(
      `SELECT comite_numero, comite_fecha, permisos_en_agenda, permisos_resueltos,
              round(promedio_dias)::int AS promedio_dias
         FROM v_resumen_comite
        WHERE permisos_en_agenda > 0
        ORDER BY comite_numero`,
    )

    // --- Distribución del semáforo ---
    const wbSem = new WhereBuilder()
    scopePermisos(wbSem, user)
    const semaforo = await pool.query(
      `SELECT semaforo, count(*)::int AS cantidad
         FROM v_permisos ${wbSem.where}
        GROUP BY semaforo`,
      wbSem.params,
    )

    // --- Tabla: los 10 permisos más antiguos sin resolver ---
    const wbAntiguos = new WhereBuilder()
    scopePermisos(wbAntiguos, user)
    wbAntiguos.addRaw(`estado = 'Pendiente'`)
    wbAntiguos.addRaw('fecha_ingreso IS NOT NULL')

    const masAntiguos = await pool.query(
      `SELECT id, id_excel, nombre, organismo_nombre, proyecto_nombre, empresa_nombre,
              fecha_ingreso, dias_tramitacion, semaforo
         FROM v_permisos ${wbAntiguos.where}
        ORDER BY dias_tramitacion DESC NULLS LAST
        LIMIT 10`,
      wbAntiguos.params,
    )

    res.json({
      kpis: {
        ...kpis.rows[0],
        total_proyectos: proyectos.rows[0].total_proyectos,
        proyectos_con_pendientes: proyectos.rows[0].proyectos_con_pendientes,
        inversion_bloqueada_mmusd: Number(proyectos.rows[0].inversion_bloqueada_mmusd),
      },
      por_organismo: porOrganismo.rows,
      evolucion_comites: evolucion.rows,
      semaforo: semaforo.rows,
      mas_antiguos: masAntiguos.rows,
    })
  } catch (err) {
    next(err)
  }
})

export default router
