-- 0014 (hand-written, 26-11-2026): columns the new "Tablas CME" sheet needs.
--
-- The 20261126 spreadsheet replaced the "Tablas PPT Actualizada" sheet with
-- "Tablas CME", whose formulas read four new columns of the Proyectos sheet:
--
--   factibilidad        column AI "Factibilidad" (Liberado, En curso,
--                       Desistido, Diferido, Baja). Manual correction of the
--                       team: Table 1 ("Liberados", last session) and
--                       Table 2.2 add the "Liberado" ones and drop the
--                       "En curso" ones.
--   estado_liberacion   column AJ "Estado (Liberado, en curso, Desistido)".
--                       "Desistido" feeds the new Table 1 row "Desistidos" and
--                       is left out of the released projects.
--   comite_ingreso      column AK: session number in which a 2nd-batch
--                       project joined the follow-up (Table 1 counts it from
--                       that session on).
--   etapa_liberados     column AN: the stage Table 2.2 groups the released
--                       projects by (instead of etapa_proyecto).
--
-- Plain text/integer, stored as the spreadsheet writes them (see
-- db/cargar_excel.py). IF NOT EXISTS: this file can also be applied by hand
-- with scripts/aplicar-sql.sh before the deploy runs it, without failing.
-- The views use pr.* but were created before these columns, so they do not
-- show them; nothing reads them from a view (committeeTables.ts reads the
-- table), so they are not refreshed.

ALTER TABLE "proyectos" ADD COLUMN IF NOT EXISTS "factibilidad" text;
ALTER TABLE "proyectos" ADD COLUMN IF NOT EXISTS "estado_liberacion" text;
ALTER TABLE "proyectos" ADD COLUMN IF NOT EXISTS "comite_ingreso" integer;
ALTER TABLE "proyectos" ADD COLUMN IF NOT EXISTS "etapa_liberados" text;
