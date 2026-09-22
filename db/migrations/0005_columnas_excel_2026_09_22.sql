CREATE TABLE "tipologias" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sector_id" bigint NOT NULL,
	"nombre" text NOT NULL,
	CONSTRAINT "tipologias_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "tipologia_id" bigint;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "n_catastro" integer;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "incluido_en_catastro" boolean;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "en_universo_permisos" boolean;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "sigue_liberado_al_contactar" boolean;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "listado_37_proyectos_liberados" boolean;--> statement-breakpoint
ALTER TABLE "proyectos" ADD COLUMN "listado_97_proyectos_no_iniciados" boolean;--> statement-breakpoint
ALTER TABLE "permisos" ADD COLUMN "en_universo" boolean;--> statement-breakpoint
ALTER TABLE "permisos" ADD COLUMN "fecha_registro_catastro" date;--> statement-breakpoint
ALTER TABLE "permisos" ADD COLUMN "fecha_actualizacion" date;--> statement-breakpoint
ALTER TABLE "permisos" ADD COLUMN "quien_actualizo" text;--> statement-breakpoint
ALTER TABLE "tipologias" ADD CONSTRAINT "tipologias_sector_id_sectores_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_tipologia_id_tipologias_id_fk" FOREIGN KEY ("tipologia_id") REFERENCES "public"."tipologias"("id") ON DELETE no action ON UPDATE no action;