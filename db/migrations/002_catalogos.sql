-- ============================================================================
-- 002 - Catálogos normalizados
--
-- Lleva una base que ya tiene datos cargados al modelo nuevo:
--   - crea las tablas de catálogo (regiones, sectores, etapas_proyecto,
--     estados_permiso) con sus datos
--   - agrega las columnas *_id a proyectos, permisos, permisos_comite y
--     usuarios, y las llena mapeando el texto que había
--   - recién entonces borra las columnas de texto viejas
--   - recrea las vistas contra el modelo nuevo
--
-- Idempotente: se puede correr dos veces sin romper nada.
--
-- Si algún valor de texto no calza con el catálogo, la migración FALLA a
-- propósito (ver los bloques de verificación) en vez de dejar NULLs
-- silenciosos: es preferible revisar el dato a perderlo.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Tablas de catálogo
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regiones (
  id             BIGSERIAL PRIMARY KEY,
  numero         INTEGER UNIQUE,
  codigo         TEXT,
  nombre         TEXT NOT NULL UNIQUE,
  nombre_oficial TEXT
);

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
  (91, NULL, NULL, 'Nivel Central',      'Tramitación a nivel central, sin región asociada')
ON CONFLICT (id) DO NOTHING;

SELECT setval('regiones_id_seq', (SELECT max(id) FROM regiones));

CREATE TABLE IF NOT EXISTS sectores (
  id      BIGSERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE,
  orden   INTEGER NOT NULL DEFAULT 0
);

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
  (11, 'Otro',                            99)
ON CONFLICT (id) DO NOTHING;

SELECT setval('sectores_id_seq', (SELECT max(id) FROM sectores));

CREATE TABLE IF NOT EXISTS etapas_proyecto (
  id      BIGSERIAL PRIMARY KEY,
  codigo  TEXT NOT NULL UNIQUE,
  nombre  TEXT NOT NULL UNIQUE,
  orden   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO etapas_proyecto (id, codigo, nombre, orden) VALUES
  (1, 'no_iniciado',  'No se ha iniciado',       1),
  (2, 'construccion', 'En fase de construcción', 2),
  (3, 'operacion',    'En operación',            3)
ON CONFLICT (id) DO NOTHING;

SELECT setval('etapas_proyecto_id_seq', (SELECT max(id) FROM etapas_proyecto));

CREATE TABLE IF NOT EXISTS estados_permiso (
  id        BIGSERIAL PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL UNIQUE,
  es_final  BOOLEAN NOT NULL DEFAULT false,
  orden     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO estados_permiso (id, codigo, nombre, es_final, orden) VALUES
  (1, 'pendiente',  'Pendiente',  false, 1),
  (2, 'resuelto',   'Resuelto',   true,  2),
  (3, 'descartado', 'Descartado', true,  3)
ON CONFLICT (id) DO NOTHING;

SELECT setval('estados_permiso_id_seq', (SELECT max(id) FROM estados_permiso));

-- ----------------------------------------------------------------------------
-- 2. Columnas nuevas en ministerios / organismos
-- ----------------------------------------------------------------------------

ALTER TABLE ministerios ADD COLUMN IF NOT EXISTS sigla TEXT;
ALTER TABLE organismos  ADD COLUMN IF NOT EXISTS nombre_largo TEXT;

UPDATE ministerios SET sigla = v.sigla
FROM (VALUES
  ('Ministerio de Agricultura',                             'MINAGRI'),
  ('Ministerio de Bienes Nacionales',                       'MBN'),
  ('Ministerio de Defensa Nacional',                        'MDN'),
  ('Ministerio de Energía',                                 'MINENERGIA'),
  ('Ministerio de Medio Ambiente',                          'MMA'),
  ('Ministerio de Minería',                                 'MINMINERIA'),
  ('Ministerio de Obras Públicas',                          'MOP'),
  ('Ministerio de Salud',                                   'MINSAL'),
  ('Ministerio de Transportes y Telecomunicaciones',        'MTT'),
  ('Ministerio de Vivienda y Urbanismo',                    'MINVU'),
  ('Ministerio de las Culturas, las Artes y el Patrimonio', 'MINCAP')
) AS v(nombre, sigla)
WHERE ministerios.nombre = v.nombre AND ministerios.sigla IS NULL;

UPDATE organismos SET nombre_largo = v.largo
FROM (VALUES
  ('BBNN',        'Ministerio de Bienes Nacionales'),
  ('CEN',         'Coordinador Eléctrico Nacional'),
  ('CMN',         'Consejo de Monumentos Nacionales'),
  ('CONAF',       'Corporación Nacional Forestal'),
  ('DGA',         'Dirección General de Aguas'),
  ('DGAC',        'Dirección General de Aeronáutica Civil'),
  ('DIRECCION GENERAL DE CONCESIONES', 'Dirección General de Concesiones de Obras Públicas'),
  ('DOH',         'Dirección de Obras Hidráulicas'),
  ('DOM',         'Dirección de Obras Municipales'),
  ('MINVU',       'Ministerio de Vivienda y Urbanismo'),
  ('MMA',         'Ministerio del Medio Ambiente'),
  ('MTT',         'Ministerio de Transportes y Telecomunicaciones'),
  ('SAG',         'Servicio Agrícola y Ganadero'),
  ('SEA',         'Servicio de Evaluación Ambiental'),
  ('SEC',         'Superintendencia de Electricidad y Combustibles'),
  ('SEREMI SALUD','Secretaría Regional Ministerial de Salud'),
  ('SERNAGEOMIN', 'Servicio Nacional de Geología y Minería'),
  ('SSFFAA',      'Subsecretaría para las Fuerzas Armadas'),
  ('VIALIDAD',    'Dirección de Vialidad')
) AS v(nombre, largo)
WHERE organismos.nombre = v.nombre AND organismos.nombre_largo IS NULL;

CREATE INDEX IF NOT EXISTS idx_organismos_ministerio ON organismos(ministerio_id);

-- ----------------------------------------------------------------------------
-- 3. Columnas nuevas en empresas
-- ----------------------------------------------------------------------------

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS razon_social      TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email_contacto    TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS activa            BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_empresas_nombre_trgm ON empresas USING GIN (nombre gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 4. Las vistas se caen antes de tocar las columnas de las que dependen.
--    Se recrean al final del archivo.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS v_solicitudes_cambio;
DROP VIEW IF EXISTS v_resumen_organismo;
DROP VIEW IF EXISTS v_resumen_comite;
DROP VIEW IF EXISTS v_permisos_comite;
DROP VIEW IF EXISTS v_proyectos;
DROP VIEW IF EXISTS v_permisos;
DROP VIEW IF EXISTS v_historial;
DROP VIEW IF EXISTS v_usuarios;

-- ----------------------------------------------------------------------------
-- 5. proyectos: region/sector/etapa de texto a FK
-- ----------------------------------------------------------------------------

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS region_id BIGINT REFERENCES regiones(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS sector_id BIGINT REFERENCES sectores(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS etapa_id  BIGINT REFERENCES etapas_proyecto(id);

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'proyectos' AND column_name = 'region') THEN

    UPDATE proyectos p SET region_id = r.id
    FROM regiones r
    WHERE p.region_id IS NULL AND btrim(p.region) = r.nombre;

    UPDATE proyectos p SET sector_id = s.id
    FROM sectores s
    WHERE p.sector_id IS NULL AND btrim(p.sector) = s.nombre;

    -- Variantes del Excel que se consolidan en una entrada del catálogo.
    UPDATE proyectos SET sector_id = 4
      WHERE sector_id IS NULL AND btrim(sector) = 'Infraestructura';
    UPDATE proyectos SET sector_id = 1
      WHERE sector_id IS NULL AND btrim(sector) = 'Energía / Infraestructura';

    UPDATE proyectos p SET etapa_id = e.id
    FROM etapas_proyecto e
    WHERE p.etapa_id IS NULL AND btrim(p.etapa) = e.nombre;

    -- Si quedó texto sin mapear, cortamos acá en vez de perderlo en silencio.
    IF EXISTS (SELECT 1 FROM proyectos
               WHERE region IS NOT NULL AND btrim(region) <> '' AND region_id IS NULL) THEN
      RAISE EXCEPTION 'Hay regiones en proyectos que no están en el catálogo: %',
        (SELECT string_agg(DISTINCT region, ', ') FROM proyectos
          WHERE region IS NOT NULL AND btrim(region) <> '' AND region_id IS NULL);
    END IF;
    IF EXISTS (SELECT 1 FROM proyectos
               WHERE sector IS NOT NULL AND btrim(sector) <> '' AND sector_id IS NULL) THEN
      RAISE EXCEPTION 'Hay sectores en proyectos que no están en el catálogo: %',
        (SELECT string_agg(DISTINCT sector, ', ') FROM proyectos
          WHERE sector IS NOT NULL AND btrim(sector) <> '' AND sector_id IS NULL);
    END IF;
    IF EXISTS (SELECT 1 FROM proyectos
               WHERE etapa IS NOT NULL AND btrim(etapa) <> '' AND etapa_id IS NULL) THEN
      RAISE EXCEPTION 'Hay etapas en proyectos que no están en el catálogo: %',
        (SELECT string_agg(DISTINCT etapa, ', ') FROM proyectos
          WHERE etapa IS NOT NULL AND btrim(etapa) <> '' AND etapa_id IS NULL);
    END IF;

    ALTER TABLE proyectos DROP COLUMN region;
    ALTER TABLE proyectos DROP COLUMN sector;
    ALTER TABLE proyectos DROP COLUMN etapa;
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS idx_proyectos_region ON proyectos(region_id);
CREATE INDEX IF NOT EXISTS idx_proyectos_sector ON proyectos(sector_id);
CREATE INDEX IF NOT EXISTS idx_proyectos_etapa  ON proyectos(etapa_id);

-- ----------------------------------------------------------------------------
-- 6. permisos: estado de texto a FK
-- ----------------------------------------------------------------------------

ALTER TABLE permisos ADD COLUMN IF NOT EXISTS estado_id BIGINT REFERENCES estados_permiso(id);

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'permisos' AND column_name = 'estado') THEN

    UPDATE permisos p SET estado_id = e.id
    FROM estados_permiso e
    WHERE p.estado_id IS NULL AND btrim(p.estado) = e.nombre;

    IF EXISTS (SELECT 1 FROM permisos WHERE estado_id IS NULL) THEN
      RAISE EXCEPTION 'Hay estados de permiso que no están en el catálogo: %',
        (SELECT string_agg(DISTINCT COALESCE(estado, '<null>'), ', ')
           FROM permisos WHERE estado_id IS NULL);
    END IF;

    ALTER TABLE permisos DROP COLUMN estado;
  END IF;
END
$mig$;

UPDATE permisos SET estado_id = 1 WHERE estado_id IS NULL;
ALTER TABLE permisos ALTER COLUMN estado_id SET NOT NULL;
ALTER TABLE permisos ALTER COLUMN estado_id SET DEFAULT 1;

DROP INDEX IF EXISTS idx_permisos_estado;
CREATE INDEX idx_permisos_estado ON permisos(estado_id);

-- ----------------------------------------------------------------------------
-- 7. permisos_comite: estado_snapshot de texto a FK
-- ----------------------------------------------------------------------------

ALTER TABLE permisos_comite
  ADD COLUMN IF NOT EXISTS estado_snapshot_id BIGINT REFERENCES estados_permiso(id);

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'permisos_comite' AND column_name = 'estado_snapshot') THEN

    UPDATE permisos_comite pc SET estado_snapshot_id = e.id
    FROM estados_permiso e
    WHERE pc.estado_snapshot_id IS NULL AND btrim(pc.estado_snapshot) = e.nombre;

    ALTER TABLE permisos_comite DROP COLUMN estado_snapshot;
  END IF;
END
$mig$;

-- ----------------------------------------------------------------------------
-- 8. usuarios: region de texto a FK
-- ----------------------------------------------------------------------------

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS region_id BIGINT REFERENCES regiones(id);

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'usuarios' AND column_name = 'region') THEN

    UPDATE usuarios u SET region_id = r.id
    FROM regiones r
    WHERE u.region_id IS NULL AND btrim(u.region) = r.nombre;

    IF EXISTS (SELECT 1 FROM usuarios
               WHERE region IS NOT NULL AND btrim(region) <> '' AND region_id IS NULL) THEN
      RAISE EXCEPTION 'Hay usuarios con una región que no está en el catálogo: %',
        (SELECT string_agg(DISTINCT region, ', ') FROM usuarios
          WHERE region IS NOT NULL AND btrim(region) <> '' AND region_id IS NULL);
    END IF;

    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_scope_check;
    ALTER TABLE usuarios DROP COLUMN region;
  END IF;
END
$mig$;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_scope_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_scope_check CHECK (
  (rol = 'empresa'   AND empresa_id   IS NOT NULL) OR
  (rol = 'organismo' AND organismo_id IS NOT NULL) OR
  (rol = 'region'    AND region_id    IS NOT NULL) OR
  (rol IN ('admin', 'oasi'))
);

-- ============================================================================
-- 9. Vistas recreadas contra el modelo nuevo.
--    Son idénticas a las de db/schema.sql: si tocás una, tocá las dos.
--
--    Van dentro de la misma transacción que las abrió: si algo falla acá, el
--    ROLLBACK deja la base con las vistas viejas intactas en vez de sin vistas.
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
SELECT
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
  pc.compromiso      AS compromiso,
  COALESCE(
    pc.dias_snapshot,
    CASE WHEN p.fecha_ingreso IS NOT NULL
         THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)
         ELSE NULL END
  )                                                                AS dias_tramitacion,
  COALESCE(
    eps.nombre,
    CASE WHEN p.fecha_resolucion IS NOT NULL AND p.fecha_resolucion <= c.fecha
         THEN ep.nombre
         ELSE 'Pendiente' END
  )                                                                AS estado_a_la_fecha,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN COALESCE(pc.dias_snapshot,
              (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)) < 90
       ELSE NULL END                                              AS menos_3_meses,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN COALESCE(pc.dias_snapshot,
              (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)) BETWEEN 90 AND 180
       ELSE NULL END                                              AS entre_3_y_6_meses,
  CASE WHEN p.fecha_ingreso IS NOT NULL
       THEN COALESCE(pc.dias_snapshot,
              (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)) > 180
       ELSE NULL END                                              AS supera_6_meses
FROM permisos_comite pc
JOIN permisos p              ON p.id  = pc.permiso_id
JOIN estados_permiso ep      ON ep.id = p.estado_id
LEFT JOIN estados_permiso eps ON eps.id = pc.estado_snapshot_id
JOIN comites c               ON c.id  = pc.comite_id
JOIN proyectos pr            ON pr.id = p.proyecto_id
JOIN organismos o            ON o.id  = p.organismo_id
JOIN ministerios m           ON m.id  = o.ministerio_id
JOIN empresas e              ON e.id  = pr.empresa_id
LEFT JOIN regiones r         ON r.id  = pr.region_id
LEFT JOIN sectores s         ON s.id  = pr.sector_id
LEFT JOIN etapas_proyecto et ON et.id = pr.etapa_id;

CREATE VIEW v_resumen_comite AS
SELECT
  c.id                                                          AS comite_id,
  c.numero                                                      AS comite_numero,
  c.fecha                                                       AS comite_fecha,
  COUNT(pc.id)                                                  AS permisos_en_agenda,
  COUNT(pc.id) FILTER (
    WHERE COALESCE(
      eps.es_final,
      (p.fecha_resolucion IS NOT NULL AND p.fecha_resolucion <= c.fecha AND ep.es_final)
    )
  )                                                              AS permisos_resueltos,
  AVG(
    COALESCE(pc.dias_snapshot,
      CASE WHEN p.fecha_ingreso IS NOT NULL
           THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)
           ELSE NULL END)
  )                                                              AS promedio_dias
FROM comites c
LEFT JOIN permisos_comite pc  ON pc.comite_id = c.id
LEFT JOIN permisos p          ON p.id  = pc.permiso_id
LEFT JOIN estados_permiso ep  ON ep.id = p.estado_id
LEFT JOIN estados_permiso eps ON eps.id = pc.estado_snapshot_id
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

COMMIT;
