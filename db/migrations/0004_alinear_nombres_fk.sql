-- Alinea el nombre de las claves foráneas y de un índice con lo que generan
-- los modelos.
--
-- Igual que 0003 pero para las FK: Postgres las llama `<tabla>_<col>_fkey`;
-- drizzle-kit las nombra `<tabla>_<col>_<tabla_destino>_<col_destino>_fk`.
-- No cambia nada funcional (misma columna, misma tabla destino, mismo ON
-- DELETE), pero deja una base migrada idéntica a una creada desde los
-- modelos, así nadie ve diferencias fantasma más adelante.
--
-- Idempotente: si la base ya nació de los modelos, no hace nada.

DO $$
DECLARE
  par RECORD;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('adjuntos', 'adjuntos_permiso_id_fkey', 'adjuntos_permiso_id_permisos_id_fk'),
      ('organismos', 'organismos_ministerio_id_fkey', 'organismos_ministerio_id_ministerios_id_fk'),
      ('permisos', 'permisos_estado_id_fkey', 'permisos_estado_id_estados_permiso_id_fk'),
      ('permisos', 'permisos_organismo_id_fkey', 'permisos_organismo_id_organismos_id_fk'),
      ('permisos', 'permisos_proyecto_id_fkey', 'permisos_proyecto_id_proyectos_id_fk'),
      ('permisos_comite', 'permisos_comite_comite_id_fkey', 'permisos_comite_comite_id_comites_id_fk'),
      ('permisos_comite', 'permisos_comite_estado_snapshot_id_fkey', 'permisos_comite_estado_snapshot_id_estados_permiso_id_fk'),
      ('permisos_comite', 'permisos_comite_permiso_id_fkey', 'permisos_comite_permiso_id_permisos_id_fk'),
      ('proyectos', 'proyectos_empresa_id_fkey', 'proyectos_empresa_id_empresas_id_fk'),
      ('proyectos', 'proyectos_etapa_id_fkey', 'proyectos_etapa_id_etapas_proyecto_id_fk'),
      ('proyectos', 'proyectos_region_id_fkey', 'proyectos_region_id_regiones_id_fk'),
      ('proyectos', 'proyectos_sector_id_fkey', 'proyectos_sector_id_sectores_id_fk'),
      ('usuarios', 'usuarios_empresa_id_fkey', 'usuarios_empresa_id_empresas_id_fk'),
      ('usuarios', 'usuarios_organismo_id_fkey', 'usuarios_organismo_id_organismos_id_fk'),
      ('usuarios', 'usuarios_region_id_fkey', 'usuarios_region_id_regiones_id_fk')
    ) AS t(tabla, viejo, nuevo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = par.viejo AND conrelid = par.tabla::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', par.tabla, par.viejo, par.nuevo);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- El índice de la cola de aprobaciones: el modelo lo declara con
-- `solicitado_at DESC`, que drizzle escribe como DESC NULLS LAST. La columna
-- es NOT NULL, así que ordenan igual, pero se recrea para que las dos bases
-- tengan exactamente la misma definición.
DROP INDEX IF EXISTS idx_solicitudes_estado;
--> statement-breakpoint
CREATE INDEX idx_solicitudes_estado ON solicitudes_cambio (estado, solicitado_at DESC NULLS LAST);
