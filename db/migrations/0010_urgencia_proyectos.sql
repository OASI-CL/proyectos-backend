-- 0010 (generada con drizzle-kit desde src/db/schema/, 29-10-2026)
--
-- proyectos.urgencia: la columna "Urgencia" de la hoja Proyectos de la
-- planilla (prioridad del proyecto: "Próximos a iniciar construcción 1/2",
-- "Inversión", "Empleo", "Inversión y Empleo"). La usa la frase resumen de
-- las Tablas del comité ("Tablas PPT Actualizada").
-- No hace falta refrescar vistas: ninguna vista necesita esta columna.
ALTER TABLE "proyectos" ADD COLUMN "urgencia" text;
