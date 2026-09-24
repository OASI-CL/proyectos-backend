-- 0009: refresca las vistas después de la 0008 (columnas nuevas en proyectos
-- y permisos). Mismo contenido que la 0007: Postgres resuelve p.* / pr.* UNA
-- vez al crear la vista, así que cualquier migración que agregue columnas a
-- proyectos o permisos tiene que terminar recreándolas. No cambia lógica.

DROP VIEW IF EXISTS v_resumen_comite;
DROP VIEW IF EXISTS v_permisos_comite;
DROP VIEW IF EXISTS v_proyectos;
DROP VIEW IF EXISTS v_permisos;

CREATE VIEW v_permisos AS
SELECT
  p.*,
  ep.nombre          AS estado,
  ep.codigo          AS estado_codigo,
  ep.es_final        AS estado_es_final,
  pr.nombre          AS proyecto_nombre,
  pr.id_excel        AS proyecto_id_excel,
  o.nombre           AS organismo_nombre,
  o.ministerio_id    AS ministerio_id,
  m.nombre           AS ministerio_nombre,
  e.id               AS empresa_id,
  e.nombre           AS empresa_nombre,
  pr.region_id       AS region_id,
  r.nombre           AS region,
  pr.sector_id       AS sector_id,
  s.nombre           AS sector,
  pr.etapa_id        AS etapa_id,
  et.nombre          AS etapa,
  pr.inversion_mmusd AS inversion_mmusd,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso)
       ELSE NULL END                                            AS dias_tramitacion,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) < 90
       ELSE NULL END                                            AS menos_3_meses,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) BETWEEN 90 AND 180
       ELSE NULL END                                            AS entre_3_y_6_meses,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) > 180
       ELSE NULL END                                            AS supera_6_meses,
  CASE
    WHEN ep.es_final THEN 'finalizado'
    WHEN p.fecha_ingreso IS NULL THEN 'en_plazo'
    WHEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) > 180 THEN 'critico'
    WHEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) >= 90 THEN 'en_alerta'
    ELSE 'en_plazo'
  END                                                            AS semaforo
FROM permisos p
JOIN estados_permiso ep ON ep.id = p.estado_id
JOIN proyectos pr       ON pr.id = p.proyecto_id
JOIN organismos o       ON o.id = p.organismo_id
JOIN ministerios m      ON m.id = o.ministerio_id
JOIN empresas e         ON e.id = pr.empresa_id
LEFT JOIN regiones r        ON r.id  = pr.region_id
LEFT JOIN sectores s        ON s.id  = pr.sector_id
LEFT JOIN etapas_proyecto et ON et.id = pr.etapa_id;

CREATE VIEW v_proyectos AS
SELECT
  pr.*,
  e.nombre  AS empresa_nombre,
  r.nombre  AS region,
  r.numero  AS region_numero,
  r.codigo  AS region_codigo,
  s.nombre  AS sector,
  et.nombre AS etapa,
  et.codigo AS etapa_codigo,
  COUNT(p.id)                                                          AS total_permisos,
  COUNT(p.id) FILTER (WHERE ep.codigo = 'pendiente')                   AS permisos_pendientes,
  COUNT(p.id) FILTER (
    WHERE ep.codigo = 'pendiente'
      AND p.fecha_ingreso IS NOT NULL
      AND (CURRENT_DATE - p.fecha_ingreso) > 180
  )                                                                    AS permisos_6meses,
  COUNT(p.id) FILTER (
    WHERE ep.codigo = 'pendiente' AND p.critico IS TRUE
  )                                                                    AS criticos_pendientes,
  (COUNT(p.id) FILTER (WHERE ep.codigo = 'pendiente') = 0)             AS sin_pendientes
FROM proyectos pr
JOIN empresas e              ON e.id  = pr.empresa_id
LEFT JOIN regiones r         ON r.id  = pr.region_id
LEFT JOIN sectores s         ON s.id  = pr.sector_id
LEFT JOIN etapas_proyecto et ON et.id = pr.etapa_id
LEFT JOIN permisos p         ON p.proyecto_id = pr.id
LEFT JOIN estados_permiso ep ON ep.id = p.estado_id
GROUP BY pr.id, e.nombre, r.nombre, r.numero, r.codigo, s.nombre, et.nombre, et.codigo;

CREATE VIEW v_permisos_comite AS
SELECT DISTINCT ON (c.id, p.id)
  p.*,
  ep.nombre          AS estado,
  ep.codigo          AS estado_codigo,
  pr.nombre          AS proyecto_nombre,
  pr.id_excel        AS proyecto_id_excel,
  o.nombre           AS organismo_nombre,
  o.ministerio_id    AS ministerio_id,
  m.nombre           AS ministerio_nombre,
  e.id               AS empresa_id,
  e.nombre           AS empresa_nombre,
  pr.region_id       AS region_id,
  r.nombre           AS region,
  pr.sector_id       AS sector_id,
  s.nombre           AS sector,
  pr.etapa_id        AS etapa_id,
  et.nombre          AS etapa,
  pr.inversion_mmusd AS inversion_mmusd,
  c.id               AS comite_id,
  c.numero           AS comite_numero,
  c.fecha            AS comite_fecha,
  co.numero          AS comite_ingreso_numero,
  pc.compromiso      AS compromiso,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)
       ELSE NULL END                                              AS dias_tramitacion,
  CASE WHEN p.fecha_resolucion IS NOT NULL AND p.fecha_resolucion <= c.fecha
       THEN ep.nombre ELSE 'Pendiente' END                        AS estado_a_la_fecha,
  CASE WHEN p.fecha_resolucion IS NOT NULL AND p.fecha_resolucion <= c.fecha
       THEN ep.es_final ELSE false END                            AS finalizado_a_la_fecha,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso) < 90
       ELSE NULL END                                              AS menos_3_meses,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso) BETWEEN 90 AND 180
       ELSE NULL END                                              AS entre_3_y_6_meses,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso) > 180
       ELSE NULL END                                              AS supera_6_meses
FROM comites c
JOIN comites co              ON co.numero < c.numero
JOIN permisos_comite pc      ON pc.comite_id = co.id
JOIN permisos p              ON p.id = pc.permiso_id
JOIN estados_permiso ep      ON ep.id = p.estado_id
JOIN proyectos pr            ON pr.id = p.proyecto_id
JOIN organismos o            ON o.id = p.organismo_id
JOIN ministerios m           ON m.id = o.ministerio_id
JOIN empresas e              ON e.id = pr.empresa_id
LEFT JOIN regiones r         ON r.id = pr.region_id
LEFT JOIN sectores s         ON s.id = pr.sector_id
LEFT JOIN etapas_proyecto et ON et.id = pr.etapa_id
ORDER BY c.id, p.id, co.numero DESC;

CREATE VIEW v_resumen_comite AS
SELECT
  c.id                                                          AS comite_id,
  c.numero                                                      AS comite_numero,
  c.fecha                                                       AS comite_fecha,
  count(vpc.id)                                                 AS permisos_en_agenda,
  count(vpc.id) FILTER (WHERE vpc.finalizado_a_la_fecha)        AS permisos_resueltos,
  avg(vpc.dias_tramitacion)                                     AS promedio_dias
FROM comites c
LEFT JOIN v_permisos_comite vpc ON vpc.comite_id = c.id
GROUP BY c.id, c.numero, c.fecha;
