-- Todo lo que el modelo de `src/db/schema/` no puede expresar y por eso se
-- escribe a mano: el trigger de auditoría, los datos de los catálogos y las
-- vistas.
--
-- Por qué no están en el modelo:
--   · TRIGGERS  Drizzle no los modela. `updated_at` lo escribe la base, no la
--               aplicación, para que nadie pueda "olvidarse" de actualizarlo.
--   · DATOS     los catálogos (regiones, sectores, etapas, estados,
--               ministerios, organismos) son listas cerradas con ids FIJOS:
--               `region_id = 3` tiene que ser Antofagasta en la base local, en
--               dev y en prod. Por eso se cargan con el schema y no con seed.py.
--   · VISTAS    acá vive TODO valor calculado (días de tramitación, conteos,
--               semáforo, acumulados por comité). Ninguna columna guarda un
--               dato derivado, así que no puede quedar desactualizado.
--
-- Si cambia una vista, se escribe una migración nueva con DROP VIEW + CREATE
-- VIEW. No se edita este archivo: ya está aplicado en las bases que existen.

-- ============================================================================
-- 1. Trigger de auditoría
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_empresas_updated_at
  BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proyectos_updated_at
  BEFORE UPDATE ON proyectos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_permisos_updated_at
  BEFORE UPDATE ON permisos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_comites_updated_at
  BEFORE UPDATE ON comites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. Datos de los catálogos (ids fijos, ver arriba)
-- ============================================================================

INSERT INTO regiones (id, numero, codigo, nombre, nombre_oficial) VALUES
  ( 1, 15, 'XV',   'Arica y Parinacota', 'Región de Arica y Parinacota'),
  ( 2,  1, 'I',    'Tarapacá',           'Región de Tarapacá'),
  ( 3,  2, 'II',   'Antofagasta',        'Región de Antofagasta'),
  ( 4,  3, 'III',  'Atacama',            'Región de Atacama'),
  ( 5,  4, 'IV',   'Coquimbo',           'Región de Coquimbo'),
  ( 6,  5, 'V',    'Valparaíso',         'Región de Valparaíso'),
  ( 7, 13, 'RM',   'Metropolitana',      'Región Metropolitana de Santiago'),
  ( 8,  6, 'VI',   'O''Higgins',         'Región del Libertador General Bernardo O''Higgins'),
  ( 9,  7, 'VII',  'Maule',              'Región del Maule'),
  (10, 16, 'XVI',  'Ñuble',              'Región de Ñuble'),
  (11,  8, 'VIII', 'Biobío',             'Región del Biobío'),
  (12,  9, 'IX',   'La Araucanía',       'Región de La Araucanía'),
  (13, 14, 'XIV',  'Los Ríos',           'Región de Los Ríos'),
  (14, 10, 'X',    'Los Lagos',          'Región de Los Lagos'),
  (15, 11, 'XI',   'Aysén',              'Región de Aysén del General Carlos Ibáñez del Campo'),
  (16, 12, 'XII',  'Magallanes',         'Región de Magallanes y de la Antártica Chilena'),
  (90, NULL, NULL, 'Interregional',      'Proyecto que abarca más de una región'),
  (91, NULL, NULL, 'Nivel Central',      'Tramitación a nivel central, sin región asociada');
INSERT INTO sectores (id, nombre, orden) VALUES
  ( 1, 'Energía',                          1),
  ( 2, 'Minería',                          2),
  ( 3, 'Inmobiliario',                     3),
  ( 4, 'Infraestructura / Obras públicas', 4),
  ( 5, 'Infraestructura de Transporte',    5),
  ( 6, 'Infraestructura Hidráulica',       6),
  ( 7, 'Saneamiento Ambiental',            7),
  ( 8, 'Agropecuario',                     8),
  ( 9, 'Pesca y Acuicultura',              9),
  (10, 'Instalaciones fabriles varias',   10),
  (11, 'Otro',                            99);
INSERT INTO etapas_proyecto (id, codigo, nombre, orden) VALUES
  (1, 'no_iniciado',  'No se ha iniciado',       1),
  (2, 'construccion', 'En fase de construcción', 2),
  (3, 'operacion',    'En operación',            3);
INSERT INTO estados_permiso (id, codigo, nombre, es_final, orden) VALUES
  (1, 'pendiente',  'Pendiente',  false, 1),
  (2, 'resuelto',   'Resuelto',   true,  2),
  (3, 'descartado', 'Descartado', true,  3);
INSERT INTO ministerios (id, nombre, sigla) VALUES
  ( 1, 'Ministerio de Agricultura',                             'MINAGRI'),
  ( 2, 'Ministerio de Bienes Nacionales',                       'MBN'),
  ( 3, 'Ministerio de Defensa Nacional',                        'MDN'),
  ( 4, 'Ministerio de Energía',                                 'MINENERGIA'),
  ( 5, 'Ministerio de Medio Ambiente',                          'MMA'),
  ( 6, 'Ministerio de Minería',                                 'MINMINERIA'),
  ( 7, 'Ministerio de Obras Públicas',                          'MOP'),
  ( 8, 'Ministerio de Salud',                                   'MINSAL'),
  ( 9, 'Ministerio de Transportes y Telecomunicaciones',        'MTT'),
  (10, 'Ministerio de Vivienda y Urbanismo',                    'MINVU'),
  (11, 'Ministerio de las Culturas, las Artes y el Patrimonio', 'MINCAP'),
  (12, 'Municipalidades',                                       NULL);
INSERT INTO organismos (id, id_excel, nombre, nombre_largo, ministerio_id) VALUES
  ( 1, 'BBNN',        'BBNN',        'Ministerio de Bienes Nacionales',                        2),
  ( 2, 'CEN',         'CEN',         'Coordinador Eléctrico Nacional',                         4),
  ( 3, 'CMN',         'CMN',         'Consejo de Monumentos Nacionales',                      11),
  ( 4, 'CONAF',       'CONAF',       'Corporación Nacional Forestal',                          1),
  ( 5, 'DGA',         'DGA',         'Dirección General de Aguas',                             7),
  ( 6, 'DGAC',        'DGAC',        'Dirección General de Aeronáutica Civil',                 3),
  ( 7, 'DIRECCION GENERAL DE CONCESIONES', 'DIRECCION GENERAL DE CONCESIONES',
                                     'Dirección General de Concesiones de Obras Públicas',     7),
  ( 8, 'DOH',         'DOH',         'Dirección de Obras Hidráulicas',                         7),
  ( 9, 'DOM',         'DOM',         'Dirección de Obras Municipales',                        12),
  (10, 'MINVU',       'MINVU',       'Ministerio de Vivienda y Urbanismo',                    10),
  (11, 'MMA',         'MMA',         'Ministerio del Medio Ambiente',                          5),
  (12, 'MTT',         'MTT',         'Ministerio de Transportes y Telecomunicaciones',         9),
  (13, 'SAG',         'SAG',         'Servicio Agrícola y Ganadero',                           1),
  (14, 'SEA',         'SEA',         'Servicio de Evaluación Ambiental',                       5),
  (15, 'SEC',         'SEC',         'Superintendencia de Electricidad y Combustibles',        4),
  (16, 'SEREMI SALUD','SEREMI SALUD','Secretaría Regional Ministerial de Salud',               8),
  (17, 'SERNAGEOMIN', 'SERNAGEOMIN', 'Servicio Nacional de Geología y Minería',                6),
  (18, 'SSFFAA',      'SSFFAA',      'Subsecretaría para las Fuerzas Armadas',                 3),
  (19, 'VIALIDAD',    'VIALIDAD',    'Dirección de Vialidad',                                  7);

SELECT setval('regiones_id_seq', (SELECT max(id) FROM regiones));
SELECT setval('sectores_id_seq', (SELECT max(id) FROM sectores));
SELECT setval('etapas_proyecto_id_seq', (SELECT max(id) FROM etapas_proyecto));
SELECT setval('estados_permiso_id_seq', (SELECT max(id) FROM estados_permiso));
SELECT setval('ministerios_id_seq', (SELECT max(id) FROM ministerios));
SELECT setval('organismos_id_seq', (SELECT max(id) FROM organismos));

-- ============================================================================
-- 3. Vistas: todo valor calculado vive acá, nunca en una columna
-- ============================================================================

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
  -- región/sector/etapa/inversión viven en el proyecto, pero la página de
  -- Permisos filtra por ellas, así que la vista las expone acá también.
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

CREATE VIEW v_resumen_organismo AS
SELECT
  o.id                                                          AS organismo_id,
  o.nombre                                                      AS organismo_nombre,
  o.ministerio_id                                               AS ministerio_id,
  m.nombre                                                      AS ministerio_nombre,
  COUNT(p.id) FILTER (WHERE ep.codigo = 'pendiente')            AS pendientes,
  COUNT(p.id) FILTER (
    WHERE ep.codigo = 'pendiente'
      AND p.fecha_ingreso IS NOT NULL
      AND (CURRENT_DATE - p.fecha_ingreso) > 180
  )                                                              AS supera_6_meses,
  AVG(
    CASE WHEN ep.codigo = 'pendiente' AND p.fecha_ingreso IS NOT NULL
         THEN (CURRENT_DATE - p.fecha_ingreso)
         ELSE NULL END
  )                                                              AS promedio_dias,
  (SELECT COALESCE(SUM(sub.inversion_mmusd), 0)
     FROM (
       SELECT DISTINCT pr2.id, pr2.inversion_mmusd
       FROM proyectos pr2
       JOIN permisos p2          ON p2.proyecto_id = pr2.id
       JOIN estados_permiso ep2  ON ep2.id = p2.estado_id
       WHERE p2.organismo_id = o.id AND ep2.codigo = 'pendiente'
     ) AS sub
  )                                                              AS inversion_bloqueada_mmusd
FROM organismos o
JOIN ministerios m           ON m.id = o.ministerio_id
LEFT JOIN permisos p         ON p.organismo_id = o.id
LEFT JOIN estados_permiso ep ON ep.id = p.estado_id
GROUP BY o.id, o.nombre, o.ministerio_id, m.nombre;

CREATE VIEW v_historial AS
SELECT
  h.*,
  u.nombre AS usuario_nombre
FROM historial h
LEFT JOIN usuarios u ON u.cognito_sub = h.usuario_sub
ORDER BY h.created_at DESC;

CREATE VIEW v_usuarios AS
SELECT
  u.*,
  e.nombre AS empresa_nombre,
  o.nombre AS organismo_nombre,
  r.nombre AS region
FROM usuarios u
LEFT JOIN empresas   e ON e.id = u.empresa_id
LEFT JOIN organismos o ON o.id = u.organismo_id
LEFT JOIN regiones   r ON r.id = u.region_id;

CREATE VIEW v_solicitudes_cambio AS
SELECT
  s.*,
  u.nombre                                   AS solicitado_por_nombre,
  r.nombre                                   AS revisado_por_nombre,
  CASE s.entidad
    WHEN 'proyecto' THEN pr.nombre
    WHEN 'permiso'  THEN pe.nombre
  END                                        AS entidad_nombre,
  CASE s.entidad
    WHEN 'proyecto' THEN pr.id_excel
    WHEN 'permiso'  THEN pe.id_excel
  END                                        AS entidad_id_excel,
  -- Columnas de alcance: la cola de aprobaciones se filtra con estas, así una
  -- empresa u organismo solo ve solicitudes sobre registros que ya puede ver.
  COALESCE(pr.empresa_id, pr2.empresa_id)    AS empresa_id,
  COALESCE(e.nombre, e2.nombre)              AS empresa_nombre,
  o.id                                       AS organismo_id,
  o.nombre                                   AS organismo_nombre,
  COALESCE(pr.region_id, pr2.region_id)      AS region_id,
  COALESCE(reg.nombre, reg2.nombre)          AS region
FROM solicitudes_cambio s
LEFT JOIN usuarios u    ON u.cognito_sub = s.solicitado_por
LEFT JOIN usuarios r    ON r.cognito_sub = s.revisado_por
LEFT JOIN proyectos pr  ON s.entidad = 'proyecto' AND pr.id = s.entidad_id
LEFT JOIN permisos  pe  ON s.entidad = 'permiso'  AND pe.id = s.entidad_id
LEFT JOIN proyectos pr2 ON s.entidad = 'permiso'  AND pr2.id = pe.proyecto_id
LEFT JOIN organismos o  ON o.id = pe.organismo_id
LEFT JOIN empresas  e   ON e.id = pr.empresa_id
LEFT JOIN empresas  e2  ON e2.id = pr2.empresa_id
LEFT JOIN regiones  reg  ON reg.id = pr.region_id
LEFT JOIN regiones  reg2 ON reg2.id = pr2.region_id;

