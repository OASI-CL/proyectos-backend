-- 0008 (generada con drizzle-kit desde src/db/schema/, 24-09-2026)
--
-- Para la planilla "20260923 Levantamiento de Permisos C.M.E.xlsx" y la
-- carga incremental (db/cargar_excel.py):
--   - titulares: tabla nueva. TITULAR = razón social que tramita los permisos
--     (ej. "Minera Centinela"); EMPRESA = el grupo detrás (ej. AMSA).
--   - empresas.nombre_normalizado / titulares.nombre_normalizado: claves
--     naturales de la carga incremental (el código E### no es confiable).
--   - proyectos.titular_id: el titular del proyecto, desde la tabla.
--   - permisos.codigo_cpat / nombre_decreto: columnas nuevas de la planilla.
-- Las vistas se refrescan en la 0009 (p.* / pr.* no ven columnas nuevas).
CREATE TABLE "titulares" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"nombre_normalizado" text,
	"empresa_id" bigint,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "nombre_normalizado" text;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "titular_id" bigint;--> statement-breakpoint
ALTER TABLE "permisos" ADD COLUMN "codigo_cpat" text;--> statement-breakpoint
ALTER TABLE "permisos" ADD COLUMN "nombre_decreto" text;--> statement-breakpoint
ALTER TABLE "titulares" ADD CONSTRAINT "titulares_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_titulares_nombre_normalizado" ON "titulares" USING btree ("nombre_normalizado") WHERE nombre_normalizado IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_titulares_empresa" ON "titulares" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_titulares_nombre_trgm" ON "titulares" USING gin (nombre gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_titular_id_titulares_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titulares"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_empresas_nombre_normalizado" ON "empresas" USING btree ("nombre_normalizado") WHERE nombre_normalizado IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_proyectos_titular" ON "proyectos" USING btree ("titular_id");