-- ============================================================================
-- OASI - Esquema de base de datos (PostgreSQL, RDS t3.micro)
--
-- Reglas (ver claude_instructions.md):
--   - Toda tabla usa id BIGSERIAL PK autoincremental. id_excel es solo display.
--   - Auditoría (created_by/updated_by/created_at/updated_at) en toda tabla
--     mutable: proyectos, permisos, empresas, comites, usuarios.
--   - updated_at lo pone el trigger set_updated_at(), nunca a mano.
--   - Ningún valor derivado (días de tramitación, conteos, semáforo) se
--     guarda en columna: todo vive en las vistas al final de este archivo.
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

-- ----------------------------------------------------------------------------
-- Catálogos
-- ----------------------------------------------------------------------------

CREATE TABLE ministerios (
  id      BIGSERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE
);

CREATE TABLE organismos (
  id             BIGSERIAL PRIMARY KEY,
  id_excel       TEXT,                    -- sigla del Excel (ej. 'CONAF'), solo display
  nombre         TEXT NOT NULL UNIQUE,    -- sigla/nombre del organismo, ej. 'CONAF'
  ministerio_id  BIGINT NOT NULL REFERENCES ministerios(id)
);

-- ----------------------------------------------------------------------------
-- Empresas
-- ----------------------------------------------------------------------------

CREATE TABLE empresas (
  id          BIGSERIAL PRIMARY KEY,
  id_excel    TEXT,                       -- 'E100', etc. NULL si la creó la app.
  nombre      TEXT NOT NULL,
  rut         TEXT,
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_empresas_updated_at
  BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX idx_empresas_id_excel ON empresas(id_excel) WHERE id_excel IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Proyectos
-- ----------------------------------------------------------------------------

CREATE TABLE proyectos (
  id                          BIGSERIAL PRIMARY KEY,
  id_excel                    TEXT,                  -- 'P183', etc. NULL si lo creó una empresa.
  nombre                      TEXT NOT NULL,
  titular                     TEXT,                  -- razón social del titular (puede diferir de empresa)
  empresa_id                  BIGINT NOT NULL REFERENCES empresas(id),
  region                      TEXT,
  sector                      TEXT,
  inversion_mmusd             NUMERIC,
  empleo_construccion         INTEGER,
  empleo_operacion            INTEGER,
  estado_ambiental            TEXT,                  -- ej. 'RCA aprobada'; casi vacío en el Excel origen
  etapa                       TEXT,                  -- 'No se ha iniciado' | 'En fase de construcción' | 'En operación'
  fecha_inicio_construccion   DATE,
  fecha_inicio_operacion      DATE,
  habilitantes_aprobado       BOOLEAN,               -- '¿Habilitantes Aprobado?'
  fecha_ingreso                DATE,                  -- fecha de ingreso del proyecto al universo OASI
  fecha_ultima_resolucion      DATE,
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
CREATE INDEX idx_proyectos_nombre_trgm ON proyectos USING GIN (nombre gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Permisos
-- ----------------------------------------------------------------------------

CREATE TABLE permisos (
  id                        BIGSERIAL PRIMARY KEY,
  id_excel                  TEXT,                    -- 'PM1377', etc.
  proyecto_id                BIGINT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  organismo_id                BIGINT NOT NULL REFERENCES organismos(id),
  nombre                    TEXT NOT NULL,           -- 'Nombre Permiso'
  nombre_estandar            TEXT,                    -- 'Nombre Permiso Estándar'
  tipo_permiso               TEXT,                    -- catálogo libre, muy heterogéneo en el Excel origen
  n_expediente                TEXT,
  critico                    BOOLEAN NOT NULL DEFAULT false,  -- 'Es crítico (Si/No)': vacío en TODO el Excel origen a la fecha de carga, default false
  que_habilita                TEXT,                    -- construcción / operación / acceso al terreno / otro
  habilitante_construccion    BOOLEAN NOT NULL DEFAULT false,  -- '¿Es el permiso habilitante para la construcción?', dato sucio en origen (Si/si/SI/2/textos largos)
  estado                     TEXT NOT NULL DEFAULT 'Pendiente'
                              CHECK (estado IN ('Pendiente', 'Resuelto', 'Descartado')),
  fecha_ingreso               DATE,
  fecha_resolucion_estimada   DATE,
  fecha_resolucion            DATE,
  tipo_resolucion             TEXT,                    -- 'Favorable' | 'No favorable' | libre (dato sucio en origen)
  hito_tramitacion            TEXT,
  incluido_catastro_hacienda  BOOLEAN,
  n_catastro                 TEXT,
  observaciones              TEXT,
  estado_validacion          TEXT NOT NULL DEFAULT 'validado'
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
CREATE INDEX idx_permisos_estado ON permisos(estado);
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
CREATE TABLE permisos_comite (
  id               BIGSERIAL PRIMARY KEY,
  permiso_id       BIGINT NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
  comite_id        BIGINT NOT NULL REFERENCES comites(id) ON DELETE CASCADE,
  estado_snapshot  TEXT CHECK (estado_snapshot IN ('Pendiente', 'Resuelto', 'Descartado')),
  dias_snapshot    INTEGER,
  compromiso       TEXT,
  UNIQUE (permiso_id, comite_id)
);

CREATE INDEX idx_permisos_comite_permiso ON permisos_comite(permiso_id);
CREATE INDEX idx_permisos_comite_comite ON permisos_comite(comite_id);

-- ----------------------------------------------------------------------------
-- Usuarios
-- ----------------------------------------------------------------------------

CREATE TABLE usuarios (
  id            BIGSERIAL PRIMARY KEY,
  cognito_sub   TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('admin', 'oasi', 'organismo_lector', 'empresa')),
  empresa_id    BIGINT REFERENCES empresas(id),
  organismo_id  BIGINT REFERENCES organismos(id),
  created_by  TEXT,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (rol = 'empresa' AND empresa_id IS NOT NULL) OR
    (rol = 'organismo_lector' AND organismo_id IS NOT NULL) OR
    (rol IN ('admin', 'oasi'))
  )
);

CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
-- Adjuntos (S3)
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
-- VISTAS — todo cálculo derivado vive acá, nunca en columnas.
-- ============================================================================

-- v_permisos: permiso + proyecto + organismo, calculado contra CURRENT_DATE.
--
-- dias_tramitacion: desde fecha_ingreso hasta fecha_resolucion (si ya se
-- resolvió) o hasta hoy (si sigue pendiente). NULL si no hay fecha_ingreso.
CREATE VIEW v_permisos AS
SELECT
  p.*,
  pr.nombre        AS proyecto_nombre,
  pr.id_excel      AS proyecto_id_excel,
  o.nombre         AS organismo_nombre,
  m.nombre         AS ministerio_nombre,
  e.nombre         AS empresa_nombre,
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
    WHEN p.estado IN ('Resuelto', 'Descartado') THEN 'finalizado'
    WHEN p.fecha_ingreso IS NULL THEN 'en_plazo'
    WHEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) > 180 THEN 'critico'
    WHEN (COALESCE(p.fecha_resolucion, CURRENT_DATE) - p.fecha_ingreso) >= 90 THEN 'en_alerta'
    ELSE 'en_plazo'
  END                                                            AS semaforo
FROM permisos p
JOIN proyectos pr ON pr.id = p.proyecto_id
JOIN organismos o ON o.id = p.organismo_id
JOIN ministerios m ON m.id = o.ministerio_id
JOIN empresas e ON e.id = pr.empresa_id;

-- v_proyectos: proyecto + conteos agregados de sus permisos.
CREATE VIEW v_proyectos AS
SELECT
  pr.*,
  e.nombre AS empresa_nombre,
  COUNT(p.id)                                                          AS total_permisos,
  COUNT(p.id) FILTER (WHERE p.estado = 'Pendiente')                    AS permisos_pendientes,
  COUNT(p.id) FILTER (
    WHERE p.estado = 'Pendiente'
      AND p.fecha_ingreso IS NOT NULL
      AND (CURRENT_DATE - p.fecha_ingreso) > 180
  )                                                                    AS permisos_6meses,
  COUNT(p.id) FILTER (
    WHERE p.estado = 'Pendiente' AND p.critico IS TRUE
  )                                                                    AS criticos_pendientes,
  (COUNT(p.id) FILTER (WHERE p.estado = 'Pendiente') = 0)              AS sin_pendientes
FROM proyectos pr
JOIN empresas e ON e.id = pr.empresa_id
LEFT JOIN permisos p ON p.proyecto_id = pr.id
GROUP BY pr.id, e.nombre;

-- v_permisos_comite: igual que v_permisos pero calculado a la fecha del
-- comité (c.fecha) en vez de CURRENT_DATE. Si permisos_comite trae un
-- snapshot guardado (estado_snapshot/dias_snapshot) se usa ese; si no, se
-- reconstruye contra la fecha del comité.
CREATE VIEW v_permisos_comite AS
SELECT
  p.*,
  pr.nombre        AS proyecto_nombre,
  pr.id_excel      AS proyecto_id_excel,
  o.nombre         AS organismo_nombre,
  m.nombre         AS ministerio_nombre,
  e.nombre         AS empresa_nombre,
  c.id             AS comite_id,
  c.numero         AS comite_numero,
  c.fecha          AS comite_fecha,
  pc.compromiso    AS compromiso,
  COALESCE(
    pc.dias_snapshot,
    CASE WHEN p.fecha_ingreso IS NOT NULL
         THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)
         ELSE NULL END
  )                                                                AS dias_tramitacion,
  COALESCE(
    pc.estado_snapshot,
    CASE WHEN p.fecha_resolucion IS NOT NULL AND p.fecha_resolucion <= c.fecha
         THEN p.estado
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
JOIN permisos p   ON p.id = pc.permiso_id
JOIN comites c    ON c.id = pc.comite_id
JOIN proyectos pr ON pr.id = p.proyecto_id
JOIN organismos o ON o.id = p.organismo_id
JOIN ministerios m ON m.id = o.ministerio_id
JOIN empresas e   ON e.id = pr.empresa_id;

-- v_resumen_comite: una fila por sesión.
CREATE VIEW v_resumen_comite AS
SELECT
  c.id                                                          AS comite_id,
  c.numero                                                      AS comite_numero,
  c.fecha                                                       AS comite_fecha,
  COUNT(pc.id)                                                  AS permisos_en_agenda,
  COUNT(pc.id) FILTER (
    WHERE COALESCE(pc.estado_snapshot,
      CASE WHEN p.fecha_resolucion IS NOT NULL AND p.fecha_resolucion <= c.fecha
           THEN p.estado ELSE 'Pendiente' END) IN ('Resuelto', 'Descartado')
  )                                                              AS permisos_resueltos,
  AVG(
    COALESCE(pc.dias_snapshot,
      CASE WHEN p.fecha_ingreso IS NOT NULL
           THEN (LEAST(COALESCE(p.fecha_resolucion, c.fecha), c.fecha) - p.fecha_ingreso)
           ELSE NULL END)
  )                                                              AS promedio_dias
FROM comites c
LEFT JOIN permisos_comite pc ON pc.comite_id = c.id
LEFT JOIN permisos p ON p.id = pc.permiso_id
GROUP BY c.id, c.numero, c.fecha;

-- v_resumen_organismo: pendientes, +6 meses, promedio de días, inversión
-- bloqueada (suma de inversion_mmusd de proyectos con >=1 permiso pendiente
-- en ese organismo).
CREATE VIEW v_resumen_organismo AS
SELECT
  o.id                                                          AS organismo_id,
  o.nombre                                                      AS organismo_nombre,
  COUNT(p.id) FILTER (WHERE p.estado = 'Pendiente')             AS pendientes,
  COUNT(p.id) FILTER (
    WHERE p.estado = 'Pendiente'
      AND p.fecha_ingreso IS NOT NULL
      AND (CURRENT_DATE - p.fecha_ingreso) > 180
  )                                                              AS supera_6_meses,
  AVG(
    CASE WHEN p.estado = 'Pendiente' AND p.fecha_ingreso IS NOT NULL
         THEN (CURRENT_DATE - p.fecha_ingreso)
         ELSE NULL END
  )                                                              AS promedio_dias,
  (SELECT COALESCE(SUM(DISTINCT_pr.inversion_mmusd), 0)
     FROM (
       SELECT DISTINCT pr2.id, pr2.inversion_mmusd
       FROM proyectos pr2
       JOIN permisos p2 ON p2.proyecto_id = pr2.id
       WHERE p2.organismo_id = o.id AND p2.estado = 'Pendiente'
     ) AS DISTINCT_pr
  )                                                              AS inversion_bloqueada_mmusd
FROM organismos o
LEFT JOIN permisos p ON p.organismo_id = o.id
GROUP BY o.id, o.nombre;

-- v_historial: historial con nombre de usuario legible.
CREATE VIEW v_historial AS
SELECT
  h.*,
  u.nombre AS usuario_nombre
FROM historial h
LEFT JOIN usuarios u ON u.cognito_sub = h.usuario_sub
ORDER BY h.created_at DESC;
