-- 0011 (generada con drizzle-kit desde src/db/schema/, 29-10-2026)
--
-- Un proyecto creado desde la app entra al universo de seguimiento por
-- defecto (los del Excel traen su valor de la columna AG "en_universo_2").
-- El filtro por universo en las vistas está en la 0012.
ALTER TABLE "proyectos" ALTER COLUMN "en_universo_permisos" SET DEFAULT true;
