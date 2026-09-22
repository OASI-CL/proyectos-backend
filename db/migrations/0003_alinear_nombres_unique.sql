-- Alinea el nombre de las restricciones UNIQUE con el que generan los modelos.
--
-- Postgres las llama `<tabla>_<columna>_key` cuando las crea el CREATE TABLE;
-- drizzle-kit las nombra `<tabla>_<columna>_unique`. Las bases que existían
-- antes de pasar a los modelos tienen los nombres viejos.
--
-- No cambia nada funcional (mismas columnas, misma unicidad), pero sin esto
-- una base migrada y una base creada desde cero quedan distintas, y eso es
-- justo el tipo de deriva que este cambio vino a eliminar: la próxima vez que
-- alguien corra `db:generate`, drizzle vería una diferencia fantasma.
--
-- Renombrar una restricción renombra también su índice. Es idempotente: si la
-- base ya tiene el nombre nuevo (porque nació de los modelos), no hace nada.

DO $$
DECLARE
  par RECORD;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('comites',         'comites_numero_key',          'comites_numero_unique'),
      ('estados_permiso', 'estados_permiso_codigo_key',  'estados_permiso_codigo_unique'),
      ('estados_permiso', 'estados_permiso_nombre_key',  'estados_permiso_nombre_unique'),
      ('etapas_proyecto', 'etapas_proyecto_codigo_key',  'etapas_proyecto_codigo_unique'),
      ('etapas_proyecto', 'etapas_proyecto_nombre_key',  'etapas_proyecto_nombre_unique'),
      ('ministerios',     'ministerios_nombre_key',      'ministerios_nombre_unique'),
      ('organismos',      'organismos_nombre_key',       'organismos_nombre_unique'),
      ('regiones',        'regiones_nombre_key',         'regiones_nombre_unique'),
      ('regiones',        'regiones_numero_key',         'regiones_numero_unique'),
      ('sectores',        'sectores_nombre_key',         'sectores_nombre_unique'),
      ('usuarios',        'usuarios_cognito_sub_key',    'usuarios_cognito_sub_unique')
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
