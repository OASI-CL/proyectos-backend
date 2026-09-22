-- ============================================================================
-- OASI - Esquema de base de datos (PostgreSQL, RDS db.t4g.micro)
--
-- Orden del archivo (de lo más básico a lo que depende de todo lo anterior):
--   1. Extensiones y trigger de auditoría
--   2. Catálogos          tablas de referencia + sus datos semilla
--   3. Entidades          empresas, proyectos, permisos, comités
--   4. Seguridad          usuarios, solicitudes de cambio, historial, adjuntos
--   5. Vistas             todo valor derivado vive acá, nunca en una columna
--
-- Reglas (ver claude_instructions.md):
--   - Toda tabla usa id BIGSERIAL PK autoincremental. id_excel es solo display,
--     nunca foreign key.
--   - Auditoría (created_by/updated_by/created_at/updated_at) en toda tabla
--     mutable: empresas, proyectos, permisos, comites, usuarios.
--   - updated_at lo pone el trigger set_updated_at(), nunca a mano.
--   - Ningún valor derivado (días de tramitación, conteos, semáforo) se
--     guarda en columna: todo vive en las vistas al final de este archivo.
--   - Todo vocabulario controlado (región, sector, etapa, estado) es una
--     tabla de catálogo con id, no texto libre. Las vistas siguen exponiendo
--     el nombre legible con el mismo nombre de columna de siempre
--     (region, sector, etapa, estado) para que la API no cambie.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- Trigger genérico de auditoría
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. CATÁLOGOS
--
-- Son listas cerradas y chicas. Van con los datos incluidos en este mismo
-- archivo y con id explícito, por dos razones:
--   - los ids quedan estables entre la base local, dev y producción, así que
--     un INSERT con region_id = 3 significa lo mismo en todas;
--   - no dependen del Excel origen: se cargan con el schema, no con seed.py.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Regiones
--
-- id      = orden geográfico norte -> sur (es el orden en que se muestran)
-- numero  = número oficial de la región (el de la división política de Chile)
-- codigo  = numeral romano con el que se las nombra habitualmente
--
-- Las dos últimas (Interregional, Nivel Central) no son regiones reales pero
-- vienen así en el Excel origen: proyectos que cruzan varias regiones o que
-- se tramitan a nivel central. Se guardan como filas para no perder el dato
-- y para que la pantalla pueda filtrarlas igual que al resto.
-- ----------------------------------------------------------------------------

CREATE TABLE regiones (
  id             BIGSERIAL PRIMARY KEY,
  numero         INTEGER UNIQUE,          -- NULL en las dos pseudo-regiones
  codigo         TEXT,                    -- 'II', 'RM', ... NULL en las pseudo-regiones
  nombre         TEXT NOT NULL UNIQUE,    -- nombre corto, el que se muestra y el que trae el Excel
  nombre_oficial TEXT                     -- nombre largo, para informes formales
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
  (91, NULL, NULL, 'Nivel Central',      'Tramitación a nivel central, sin región asociada');

SELECT setval('regiones_id_seq', (SELECT max(id) FROM regiones));

-- ----------------------------------------------------------------------------
-- Sectores productivos
--
-- Catálogo derivado de lo que efectivamente trae el Excel origen, limpiado.
-- Dos variantes del origen se mapean acá (ver db/seed.py):
--   'Infraestructura'           -> 'Infraestructura / Obras públicas'
--   'Energía / Infraestructura' -> 'Energía'
-- ----------------------------------------------------------------------------

CREATE TABLE sectores (
  id      BIGSERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE,
  orden   INTEGER NOT NULL DEFAULT 0    -- orden de presentación en dropdowns y gráficos
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
  (11, 'Otro',                            99);


SELECT setval('sectores_id_seq', (SELECT max(id) FROM sectores));

-- ----------------------------------------------------------------------------
-- Etapas del proyecto
-- ----------------------------------------------------------------------------

CREATE TABLE etapas_proyecto (
  id      BIGSERIAL PRIMARY KEY,
  codigo  TEXT NOT NULL UNIQUE,      -- estable, es lo que usa el código
  nombre  TEXT NOT NULL UNIQUE,      -- lo que ve el usuario
  orden   INTEGER NOT NULL DEFAULT 0 -- avance real del proyecto, para ordenar
);

INSERT INTO etapas_proyecto (id, codigo, nombre, orden) VALUES
  (1, 'no_iniciado',  'No se ha iniciado',       1),
  (2, 'construccion', 'En fase de construcción', 2),
  (3, 'operacion',    'En operación',            3);

SELECT setval('etapas_proyecto_id_seq', (SELECT max(id) FROM etapas_proyecto));

-- ----------------------------------------------------------------------------
-- Estados de un permiso
--
-- es_final marca los estados que cierran la tramitación: sirve para que las
-- vistas no tengan que repetir la lista ('Resuelto', 'Descartado') en cada
-- FILTER, y para que agregar un estado nuevo mañana no obligue a editarlas.
-- ----------------------------------------------------------------------------

CREATE TABLE estados_permiso (
  id        BIGSERIAL PRIMARY KEY,
  codigo    TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL UNIQUE,
  es_final  BOOLEAN NOT NULL DEFAULT false,
  orden     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO estados_permiso (id, codigo, nombre, es_final, orden) VALUES
  (1, 'pendiente',  'Pendiente',  false, 1),
  (2, 'resuelto',   'Resuelto',   true,  2),
  (3, 'descartado', 'Descartado', true,  3);

SELECT setval('estados_permiso_id_seq', (SELECT max(id) FROM estados_permiso));

-- ----------------------------------------------------------------------------
-- Ministerios y organismos
--
-- Un organismo (CONAF, DGA, SEA, ...) pertenece siempre a un ministerio.
-- Van con datos semilla porque son el organigrama del Estado, no datos del
-- Excel: no cambian salvo reforma administrativa.
-- ----------------------------------------------------------------------------

CREATE TABLE ministerios (
  id      BIGSERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE,
  sigla   TEXT
);

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

SELECT setval('ministerios_id_seq', (SELECT max(id) FROM ministerios));

CREATE TABLE organismos (
  id             BIGSERIAL PRIMARY KEY,
  id_excel       TEXT,                    -- sigla tal como viene del Excel, solo display
  nombre         TEXT NOT NULL UNIQUE,    -- sigla con la que se lo conoce, ej. 'CONAF'
  nombre_largo   TEXT,                    -- nombre completo, para informes
  ministerio_id  BIGINT NOT NULL REFERENCES ministerios(id)
);

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

SELECT setval('organismos_id_seq', (SELECT max(id) FROM organismos));

CREATE INDEX idx_organismos_ministerio ON organismos(ministerio_id);


-- ============================================================================
-- 3. ENTIDADES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Empresas (titulares de los proyectos)
--
-- Se cargan desde el Excel (traen id_excel 'E100', etc.), pero se pueden crear
-- desde la app, y en ese caso id_excel queda NULL.
-- ----------------------------------------------------------------------------

CREATE TABLE empresas (
  id                BIGSERIAL PRIMARY KEY,
  id_excel          TEXT,                  -- 'E100', etc. NULL si la creó la app.
  nombre            TEXT NOT NULL,         -- nombre con el que se la conoce
  razon_social      TEXT,                  -- nombre legal, si difiere del anterior
  rut               TEXT,
  email_contacto    TEXT,
  telefono_contacto TEXT,
  activa            BOOLEAN NOT NULL DEFAULT true,  -- false = no se ofrece al crear proyectos nuevos
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_empresas_updated_at
  BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_empresas_id_excel ON empresas(id_excel) WHERE id_excel IS NOT NULL;
CREATE INDEX idx_empresas_nombre_trgm ON empresas USING GIN (nombre gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Proyectos
-- ----------------------------------------------------------------------------

CREATE TABLE proyectos (
  id                          BIGSERIAL PRIMARY KEY,
  id_excel                    TEXT,                  -- 'P183', etc. NULL si lo creó la app.
  nombre                      TEXT NOT NULL,
  titular                     TEXT,                  -- razón social del titular (puede diferir de empresa)
  empresa_id                  BIGINT NOT NULL REFERENCES empresas(id),
  region_id                   BIGINT REFERENCES regiones(id),
  sector_id                   BIGINT REFERENCES sectores(id),
  etapa_id                    BIGINT REFERENCES etapas_proyecto(id),
  inversion_mmusd             NUMERIC,
  empleo_construccion         INTEGER,
  empleo_operacion            INTEGER,
  estado_ambiental            TEXT,                  -- ej. 'RCA aprobada'; texto libre, casi vacío en el Excel origen
  fecha_inicio_construccion   DATE,
  fecha_inicio_operacion      DATE,
  habilitantes_aprobado       BOOLEAN,               -- '¿Habilitantes Aprobado?'
  fecha_ingreso               DATE,                  -- ingreso del proyecto al universo OASI
  fecha_ultima_resolucion     DATE,  -- sacarla
  observaciones_oasi          TEXT,
  estado_validacion           TEXT NOT NULL DEFAULT 'validado'
                                CHECK (estado_validacion IN ('borrador', 'en_revision', 'validado')),
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_proyectos_updated_at
  BEFORE UPDATE ON proyectos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_proyectos_id_excel ON proyectos(id_excel) WHERE id_excel IS NOT NULL;
CREATE INDEX idx_proyectos_empresa ON proyectos(empresa_id);
CREATE INDEX idx_proyectos_region ON proyectos(region_id);
CREATE INDEX idx_proyectos_sector ON proyectos(sector_id);
CREATE INDEX idx_proyectos_etapa ON proyectos(etapa_id);
CREATE INDEX idx_proyectos_nombre_trgm ON proyectos USING GIN (nombre gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Permisos
-- ----------------------------------------------------------------------------

CREATE TABLE permisos (
  id                          BIGSERIAL PRIMARY KEY,
  id_excel                    TEXT,                  -- 'PM1377', etc.
  proyecto_id                 BIGINT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  organismo_id                BIGINT NOT NULL REFERENCES organismos(id),
  nombre                      TEXT NOT NULL,         -- 'Nombre Permiso'
  nombre_estandar             TEXT,                  -- 'Nombre Permiso Estándar'
  tipo_permiso                TEXT,                  -- texto libre: muy heterogéneo en el Excel origen
  n_expediente                TEXT,
  critico                     BOOLEAN NOT NULL DEFAULT false,  -- 'Es crítico (Si/No)': vacío en TODO el Excel origen, default false
  que_habilita                TEXT,                  -- construcción / operación / acceso al terreno / otro
  habilitante_construccion    BOOLEAN NOT NULL DEFAULT false,  -- dato sucio en origen (Si/si/SI/2/textos largos)
  estado_id                   BIGINT NOT NULL DEFAULT 1 REFERENCES estados_permiso(id),  -- 1 = Pendiente (ver catálogo arriba)
  fecha_ingreso               DATE,
  fecha_resolucion_estimada   DATE,
  fecha_resolucion            DATE,
  tipo_resolucion             TEXT,                  -- 'Favorable' | 'No favorable' | libre (dato sucio en origen)
  hito_tramitacion            TEXT,
  incluido_catastro_hacienda  BOOLEAN,
  n_catastro                  TEXT,
  observaciones               TEXT,
  estado_validacion           TEXT NOT NULL DEFAULT 'validado'
                                CHECK (estado_validacion IN ('borrador', 'en_revision', 'validado')),
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_permisos_updated_at
  BEFORE UPDATE ON permisos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_permisos_id_excel ON permisos(id_excel) WHERE id_excel IS NOT NULL;
CREATE INDEX idx_permisos_proyecto ON permisos(proyecto_id);
CREATE INDEX idx_permisos_organismo ON permisos(organismo_id);
CREATE INDEX idx_permisos_estado ON permisos(estado_id);
CREATE INDEX idx_permisos_nombre_trgm ON permisos USING GIN (nombre gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Comités
-- ----------------------------------------------------------------------------

CREATE TABLE comites (
  id          BIGSERIAL PRIMARY KEY,
  numero      INTEGER NOT NULL UNIQUE,
  fecha       DATE NOT NULL,
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_comites_updated_at
  BEFORE UPDATE ON comites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Relación N:N: un permiso se revisa en varias sesiones.
-- Los *_snapshot congelan cómo estaba el permiso el día de esa sesión, para
-- poder reconstruir la tabla exacta que se presentó en el comité.
CREATE TABLE permisos_comite (
  id                  BIGSERIAL PRIMARY KEY,
  permiso_id          BIGINT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  comite_id           BIGINT NOT NULL REFERENCES comites(id) ON DELETE CASCADE,
  estado_snapshot_id  BIGINT REFERENCES estados_permiso(id),
  dias_snapshot       INTEGER,
  compromiso          TEXT,
  UNIQUE (permiso_id, comite_id)
);

CREATE INDEX idx_permisos_comite_permiso ON permisos_comite(permiso_id);
CREATE INDEX idx_permisos_comite_comite ON permisos_comite(comite_id);


-- ============================================================================
-- 4. SEGURIDAD Y AUDITORÍA
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Usuarios
--
-- Roles:
--   admin      gestiona usuarios y su alcance
--   oasi       ve todo y aprueba lo que mandan los demás roles
--   organismo  ve los permisos de su organismo y los proyectos detrás de ellos;
--              puede PROPONER ediciones de permiso, que OASI debe aprobar
--   empresa    ve solo sus proyectos/permisos, puede proponer altas
--   region     ve todos los proyectos de su región, de cualquier organismo (solo lectura)
-- ----------------------------------------------------------------------------

CREATE TABLE usuarios (
  id            BIGSERIAL PRIMARY KEY,
  cognito_sub   TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL,
  rol           TEXT NOT NULL,
  empresa_id    BIGINT REFERENCES empresas(id),    -- alcance del rol 'empresa'
  organismo_id  BIGINT REFERENCES organismos(id),  -- alcance del rol 'organismo'
  region_id     BIGINT REFERENCES regiones(id),    -- alcance del rol 'region'
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_rol_check
    CHECK (rol IN ('admin', 'oasi', 'organismo', 'empresa', 'region')),
  -- Cada rol acotado tiene que traer el alcance al que está limitado.
  CONSTRAINT usuarios_scope_check CHECK (
    (rol = 'empresa'   AND empresa_id   IS NOT NULL) OR
    (rol = 'organismo' AND organismo_id IS NOT NULL) OR
    (rol = 'region'    AND region_id    IS NOT NULL) OR
    (rol IN ('admin', 'oasi'))
  )
);

CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Solicitudes de cambio (flujo de aprobación)
--
-- Los roles que necesitan aprobación (empresa, organismo) nunca escriben
-- directo en proyectos/permisos: sus ediciones quedan acá como propuesta y
-- OASI las aplica o las rechaza, así las tablas vivas siguen siendo
-- confiables para los reportes.
--
--   tipo = 'creacion' -> la fila ya existe con estado_validacion='en_revision';
--                        aprobar la pasa a 'validado'.
--   tipo = 'edicion'  -> `cambios` trae los valores propuestos; aprobar los
--                        aplica y escribe las filas de historial de siempre.
-- ----------------------------------------------------------------------------

CREATE TABLE solicitudes_cambio (
  id                   BIGSERIAL PRIMARY KEY,
  entidad              TEXT NOT NULL CHECK (entidad IN ('proyecto', 'permiso')),
  entidad_id           BIGINT NOT NULL,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('creacion', 'edicion')),
  cambios              JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado               TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  comentario           TEXT,
  solicitado_por       TEXT NOT NULL,
  solicitado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisado_por         TEXT,
  revisado_at          TIMESTAMPTZ,
  comentario_revision  TEXT
);

CREATE INDEX idx_solicitudes_estado ON solicitudes_cambio(estado, solicitado_at DESC);
CREATE INDEX idx_solicitudes_entidad ON solicitudes_cambio(entidad, entidad_id);

-- Una sola solicitud abierta por entidad, así dos personas no encolan
-- ediciones en conflicto sobre el mismo permiso.
CREATE UNIQUE INDEX idx_solicitudes_una_pendiente
  ON solicitudes_cambio(entidad, entidad_id)
  WHERE estado = 'pendiente';

-- ----------------------------------------------------------------------------
-- Historial (diff campo a campo, lo escribe el backend en cada UPDATE)
-- ----------------------------------------------------------------------------

CREATE TABLE historial (
  id              BIGSERIAL PRIMARY KEY,
  entidad         TEXT NOT NULL CHECK (entidad IN ('proyecto', 'permiso', 'empresa')),
  entidad_id      BIGINT NOT NULL,
  campo           TEXT NOT NULL,
  valor_anterior  TEXT,
  valor_nuevo     TEXT,
  usuario_sub     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historial_entidad ON historial(entidad, entidad_id);

-- ----------------------------------------------------------------------------
-- Adjuntos (el archivo vive en S3; acá solo la metadata)
-- ----------------------------------------------------------------------------

CREATE TABLE adjuntos (
  id             BIGSERIAL PRIMARY KEY,
  permiso_id     BIGINT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  nombre_archivo TEXT NOT NULL,
  s3_key         TEXT NOT NULL,
  content_type   TEXT,
  size_bytes     BIGINT,
  uploaded_by    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_adjuntos_permiso ON adjuntos(permiso_id);


-- ============================================================================
-- 5. VISTAS — todo cálculo derivado vive acá, nunca en columnas.
--
-- Las vistas resuelven los catálogos y exponen el nombre legible con el mismo
-- nombre de columna que tenía antes de normalizar (region, sector, etapa,
-- estado), además del *_id. Así el frontend y los filtros existentes siguen
-- funcionando igual, y quien quiera filtrar por id también puede.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_permisos: permiso + proyecto + organismo, calculado contra CURRENT_DATE.
--
-- dias_tramitacion: desde fecha_ingreso hasta fecha_resolucion (si ya se
-- resolvió) o hasta hoy (si sigue pendiente). NULL si no hay fecha_ingreso.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- v_proyectos: proyecto + catálogos resueltos + conteos agregados de permisos.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- v_resumen_organismo: pendientes, +6 meses, promedio de días, inversión
-- bloqueada (suma de inversion_mmusd de proyectos con >=1 permiso pendiente
-- en ese organismo).
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- v_historial: historial con nombre de usuario legible.
-- ----------------------------------------------------------------------------
CREATE VIEW v_historial AS
SELECT
  h.*,
  u.nombre AS usuario_nombre
FROM historial h
LEFT JOIN usuarios u ON u.cognito_sub = h.usuario_sub
ORDER BY h.created_at DESC;

-- ----------------------------------------------------------------------------
-- v_usuarios: usuario con su alcance resuelto a nombres legibles.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- v_solicitudes_cambio: solicitudes con el nombre de la entidad y de quien la
-- pidió resueltos, para que la pantalla de aprobaciones no tenga que hacer
-- tres round trips extra por fila.
-- ----------------------------------------------------------------------------
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
