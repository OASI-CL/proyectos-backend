-- ============================================================================
-- 003 - El comité N cuenta los permisos de los comités ANTERIORES a N
-- ============================================================================
--
-- Antes: cada comité mostraba solo los permisos vinculados a esa sesión en
-- `permisos_comite`. Como el Excel origen guarda un único comité por permiso
-- (el "actual"), las sesiones más nuevas aparecían con 0 permisos: el comité
-- 12 y el 13 mostraban la tabla vacía.
--
-- Ahora: la tabla del comité N son todos los permisos que entraron en comités
-- con número MENOR a N, con sus cálculos hechos a la fecha de la sesión N.
-- Es acumulativo y ESTRICTO: los permisos que entraron en el propio comité N
-- no se cuentan en la tabla de N (aparecen desde N+1 en adelante).
--
-- Efecto en los datos actuales: el comité 6 pasa de 239 a 0 (los comités 4 y 5
-- no tienen permisos), el 8 de 254 a 482, el 11 de 17 a 837 y el 13 de 0 a 854.
--
-- Los snapshots (estado_snapshot_id, dias_snapshot) dejan de usarse en esta
-- vista: guardaban cómo estaba el permiso en SU sesión, y acá cada permiso se
-- muestra en sesiones distintas de la propia, así que todo se recalcula contra
-- la fecha de la sesión que se está viendo. Las columnas quedan en la tabla
-- por si más adelante se vuelve a necesitar el dato congelado.
-- ============================================================================

DROP VIEW IF EXISTS v_resumen_comite;
DROP VIEW IF EXISTS v_permisos_comite;

-- ----------------------------------------------------------------------------
-- v_permisos_comite: un permiso por cada sesión POSTERIOR a la de su ingreso,
-- con los cálculos a la fecha de esa sesión.
--
-- DISTINCT ON evita duplicados: `permisos_comite` admite que un permiso quede
-- vinculado a varias sesiones (hoy no pasa, pero el modelo lo permite), y sin
-- esto el mismo permiso aparecería una vez por cada vínculo anterior. Se
-- conserva el vínculo más reciente (co.numero DESC).
-- ----------------------------------------------------------------------------
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
  -- La sesión que se está mirando.
  c.id               AS comite_id,
  c.numero           AS comite_numero,
  c.fecha            AS comite_fecha,
  -- La sesión en la que el permiso entró (siempre anterior a la de arriba).
  co.numero          AS comite_ingreso_numero,
  pc.compromiso      AS compromiso,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)
       ELSE NULL END                                              AS dias_tramitacion,
  -- Estado tal como estaba el día de la sesión: si la resolución es posterior
  -- a esa fecha, ese día todavía estaba pendiente.
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
JOIN comites co              ON co.numero < c.numero      -- <-- el acumulado estricto
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

-- ----------------------------------------------------------------------------
-- v_resumen_comite: una fila por sesión, construida sobre la vista anterior
-- para no repetir los cálculos en dos lugares (antes estaban duplicados).
-- ----------------------------------------------------------------------------
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
