-- ============================================================================
-- Migration 001 — user roles and the approval workflow
--
-- Apply to an existing database:
--   psql -h <host> -U <user> -d <db> -f db/migrations/001_roles_and_approvals.sql
--
-- db/schema.sql already contains everything below; this file only exists so a
-- database that was created before these changes can catch up without a
-- reload. It is idempotent.
--
-- NOTE: the schema stays in Spanish (it already holds production data);
-- application code is in English and aliases columns at the query boundary.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Roles
--
--   admin      — manages users and their scope
--   oasi       — sees everything, approves what the other roles submit
--   organismo  — was 'organismo_lector'. Sees the permits of its own agency
--                and the projects behind them. Can now PROPOSE permit edits,
--                which OASI has to approve (it is no longer read-only).
--   empresa    — sees only its own projects/permits, can submit new ones
--   region     — NEW. Sees every project of its region, across all agencies.
--                Read-only.
-- ----------------------------------------------------------------------------

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;

-- 'organismo_lector' no longer describes the role: it can write now.
UPDATE usuarios SET rol = 'organismo' WHERE rol = 'organismo_lector';

-- Scope column for the new region role (regions are free text on proyectos,
-- there is no regiones table).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS region TEXT;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'oasi', 'organismo', 'empresa', 'region'));

-- Each scoped role must carry the scope it is limited to.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_check;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_scope_check;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_scope_check
  CHECK (
    (rol = 'empresa'   AND empresa_id   IS NOT NULL) OR
    (rol = 'organismo' AND organismo_id IS NOT NULL) OR
    (rol = 'region'    AND region       IS NOT NULL) OR
    (rol IN ('admin', 'oasi'))
  );

-- ----------------------------------------------------------------------------
-- 2. Change requests
--
-- Roles that need approval (empresa, organismo) never write straight to
-- proyectos/permisos. Their edits land here as a proposal and OASI applies or
-- rejects them, so the live tables stay trustworthy for the reports.
--
--   tipo = 'creacion' — the row already exists with estado_validacion =
--                       'en_revision'; approving flips it to 'validado'.
--   tipo = 'edicion'  — `cambios` holds the proposed field values; approving
--                       applies them and writes the usual historial rows.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS solicitudes_cambio (
  id                   BIGSERIAL PRIMARY KEY,
  entidad              TEXT NOT NULL CHECK (entidad IN ('proyecto', 'permiso')),
  entidad_id           BIGINT NOT NULL,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('creacion', 'edicion')),
  cambios              JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado               TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  comentario           TEXT,          -- note from whoever submitted it
  solicitado_por       TEXT NOT NULL, -- cognito_sub
  solicitado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisado_por         TEXT,          -- cognito_sub of the OASI/admin reviewer
  revisado_at          TIMESTAMPTZ,
  comentario_revision  TEXT
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado
  ON solicitudes_cambio(estado, solicitado_at DESC);
CREATE INDEX IF NOT EXISTS idx_solicitudes_entidad
  ON solicitudes_cambio(entidad, entidad_id);

-- Only one open request per entity, so two people cannot queue conflicting
-- edits on the same permit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_una_pendiente
  ON solicitudes_cambio(entidad, entidad_id)
  WHERE estado = 'pendiente';

-- ----------------------------------------------------------------------------
-- 3. View for the approvals screen
--
-- Resolves the entity name and the requester's name so the UI does not need
-- three extra round trips per row.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS v_solicitudes_cambio;
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
  -- Context so a reviewer can judge without opening the record, and the
  -- scope columns the approvals queue is filtered with.
  COALESCE(pr.empresa_id, pr2.empresa_id)    AS empresa_id,
  COALESCE(e.nombre, e2.nombre)              AS empresa_nombre,
  o.id                                       AS organismo_id,
  o.nombre                                   AS organismo_nombre,
  COALESCE(pr.region, pr2.region)            AS region
FROM solicitudes_cambio s
LEFT JOIN usuarios u  ON u.cognito_sub = s.solicitado_por
LEFT JOIN usuarios r  ON r.cognito_sub = s.revisado_por
LEFT JOIN proyectos pr ON s.entidad = 'proyecto' AND pr.id = s.entidad_id
LEFT JOIN permisos  pe ON s.entidad = 'permiso'  AND pe.id = s.entidad_id
LEFT JOIN proyectos pr2 ON s.entidad = 'permiso' AND pr2.id = pe.proyecto_id
LEFT JOIN organismos o  ON o.id = pe.organismo_id
LEFT JOIN empresas  e   ON e.id = pr.empresa_id
LEFT JOIN empresas  e2  ON e2.id = pr2.empresa_id;

COMMIT;
