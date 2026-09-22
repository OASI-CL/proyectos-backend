CREATE TABLE "regiones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"numero" integer,
	"codigo" text,
	"nombre" text NOT NULL,
	"nombre_oficial" text,
	CONSTRAINT "regiones_numero_unique" UNIQUE("numero"),
	CONSTRAINT "regiones_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "sectores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sectores_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "etapas_proyecto" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "etapas_proyecto_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "etapas_proyecto_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "estados_permiso" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"es_final" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "estados_permiso_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "estados_permiso_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "ministerios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"sigla" text,
	CONSTRAINT "ministerios_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "organismos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"id_excel" text,
	"nombre" text NOT NULL,
	"nombre_largo" text,
	"ministerio_id" bigint NOT NULL,
	CONSTRAINT "organismos_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"id_excel" text,
	"nombre" text NOT NULL,
	"razon_social" text,
	"rut" text,
	"email_contacto" text,
	"telefono_contacto" text,
	"activa" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proyectos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"id_excel" text,
	"nombre" text NOT NULL,
	"titular" text,
	"empresa_id" bigint NOT NULL,
	"region_id" bigint,
	"sector_id" bigint,
	"etapa_id" bigint,
	"inversion_mmusd" numeric,
	"empleo_construccion" integer,
	"empleo_operacion" integer,
	"estado_ambiental" text,
	"fecha_inicio_construccion" date,
	"fecha_inicio_operacion" date,
	"habilitantes_aprobado" boolean,
	"fecha_ingreso" date,
	"fecha_ultima_resolucion" date,
	"observaciones_oasi" text,
	"estado_validacion" text DEFAULT 'validado' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proyectos_estado_validacion_check" CHECK ("proyectos"."estado_validacion" IN ('borrador', 'en_revision', 'validado'))
);
--> statement-breakpoint
CREATE TABLE "permisos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"id_excel" text,
	"proyecto_id" bigint NOT NULL,
	"organismo_id" bigint NOT NULL,
	"nombre" text NOT NULL,
	"nombre_estandar" text,
	"tipo_permiso" text,
	"n_expediente" text,
	"critico" boolean DEFAULT false NOT NULL,
	"que_habilita" text,
	"habilitante_construccion" boolean DEFAULT false NOT NULL,
	"estado_id" bigint DEFAULT 1 NOT NULL,
	"fecha_ingreso" date,
	"fecha_resolucion_estimada" date,
	"fecha_resolucion" date,
	"tipo_resolucion" text,
	"hito_tramitacion" text,
	"incluido_catastro_hacienda" boolean,
	"n_catastro" text,
	"observaciones" text,
	"estado_validacion" text DEFAULT 'validado' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permisos_estado_validacion_check" CHECK ("permisos"."estado_validacion" IN ('borrador', 'en_revision', 'validado'))
);
--> statement-breakpoint
CREATE TABLE "comites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"numero" integer NOT NULL,
	"fecha" date NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comites_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
CREATE TABLE "permisos_comite" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"permiso_id" bigint NOT NULL,
	"comite_id" bigint NOT NULL,
	"estado_snapshot_id" bigint,
	"dias_snapshot" integer,
	"compromiso" text,
	CONSTRAINT "permisos_comite_permiso_id_comite_id_key" UNIQUE("permiso_id","comite_id")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cognito_sub" text NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"rol" text NOT NULL,
	"empresa_id" bigint,
	"organismo_id" bigint,
	"region_id" bigint,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_cognito_sub_unique" UNIQUE("cognito_sub"),
	CONSTRAINT "usuarios_rol_check" CHECK ("usuarios"."rol" IN ('admin', 'oasi', 'organismo', 'empresa', 'region')),
	CONSTRAINT "usuarios_scope_check" CHECK (("usuarios"."rol" = 'empresa'   AND "usuarios"."empresa_id"   IS NOT NULL) OR
          ("usuarios"."rol" = 'organismo' AND "usuarios"."organismo_id" IS NOT NULL) OR
          ("usuarios"."rol" = 'region'    AND "usuarios"."region_id"    IS NOT NULL) OR
          ("usuarios"."rol" IN ('admin', 'oasi')))
);
--> statement-breakpoint
CREATE TABLE "solicitudes_cambio" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" bigint NOT NULL,
	"tipo" text NOT NULL,
	"cambios" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"comentario" text,
	"solicitado_por" text NOT NULL,
	"solicitado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revisado_por" text,
	"revisado_at" timestamp with time zone,
	"comentario_revision" text,
	CONSTRAINT "solicitudes_cambio_entidad_check" CHECK ("solicitudes_cambio"."entidad" IN ('proyecto', 'permiso')),
	CONSTRAINT "solicitudes_cambio_tipo_check" CHECK ("solicitudes_cambio"."tipo" IN ('creacion', 'edicion')),
	CONSTRAINT "solicitudes_cambio_estado_check" CHECK ("solicitudes_cambio"."estado" IN ('pendiente', 'aprobada', 'rechazada'))
);
--> statement-breakpoint
CREATE TABLE "historial" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" bigint NOT NULL,
	"campo" text NOT NULL,
	"valor_anterior" text,
	"valor_nuevo" text,
	"usuario_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historial_entidad_check" CHECK ("historial"."entidad" IN ('proyecto', 'permiso', 'empresa'))
);
--> statement-breakpoint
CREATE TABLE "adjuntos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"permiso_id" bigint NOT NULL,
	"nombre_archivo" text NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text,
	"size_bytes" bigint,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organismos" ADD CONSTRAINT "organismos_ministerio_id_ministerios_id_fk" FOREIGN KEY ("ministerio_id") REFERENCES "public"."ministerios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_region_id_regiones_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regiones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_sector_id_sectores_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proyectos" ADD CONSTRAINT "proyectos_etapa_id_etapas_proyecto_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."etapas_proyecto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos" ADD CONSTRAINT "permisos_proyecto_id_proyectos_id_fk" FOREIGN KEY ("proyecto_id") REFERENCES "public"."proyectos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos" ADD CONSTRAINT "permisos_organismo_id_organismos_id_fk" FOREIGN KEY ("organismo_id") REFERENCES "public"."organismos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos" ADD CONSTRAINT "permisos_estado_id_estados_permiso_id_fk" FOREIGN KEY ("estado_id") REFERENCES "public"."estados_permiso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos_comite" ADD CONSTRAINT "permisos_comite_permiso_id_permisos_id_fk" FOREIGN KEY ("permiso_id") REFERENCES "public"."permisos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos_comite" ADD CONSTRAINT "permisos_comite_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permisos_comite" ADD CONSTRAINT "permisos_comite_estado_snapshot_id_estados_permiso_id_fk" FOREIGN KEY ("estado_snapshot_id") REFERENCES "public"."estados_permiso"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organismo_id_organismos_id_fk" FOREIGN KEY ("organismo_id") REFERENCES "public"."organismos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_region_id_regiones_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regiones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_permiso_id_permisos_id_fk" FOREIGN KEY ("permiso_id") REFERENCES "public"."permisos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organismos_ministerio" ON "organismos" USING btree ("ministerio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_empresas_id_excel" ON "empresas" USING btree ("id_excel") WHERE id_excel IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_empresas_nombre_trgm" ON "empresas" USING gin (nombre gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_proyectos_id_excel" ON "proyectos" USING btree ("id_excel") WHERE id_excel IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_proyectos_empresa" ON "proyectos" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "idx_proyectos_region" ON "proyectos" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "idx_proyectos_sector" ON "proyectos" USING btree ("sector_id");--> statement-breakpoint
CREATE INDEX "idx_proyectos_etapa" ON "proyectos" USING btree ("etapa_id");--> statement-breakpoint
CREATE INDEX "idx_proyectos_nombre_trgm" ON "proyectos" USING gin (nombre gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_permisos_id_excel" ON "permisos" USING btree ("id_excel") WHERE id_excel IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_permisos_proyecto" ON "permisos" USING btree ("proyecto_id");--> statement-breakpoint
CREATE INDEX "idx_permisos_organismo" ON "permisos" USING btree ("organismo_id");--> statement-breakpoint
CREATE INDEX "idx_permisos_estado" ON "permisos" USING btree ("estado_id");--> statement-breakpoint
CREATE INDEX "idx_permisos_nombre_trgm" ON "permisos" USING gin (nombre gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_permisos_comite_permiso" ON "permisos_comite" USING btree ("permiso_id");--> statement-breakpoint
CREATE INDEX "idx_permisos_comite_comite" ON "permisos_comite" USING btree ("comite_id");--> statement-breakpoint
CREATE INDEX "idx_solicitudes_estado" ON "solicitudes_cambio" USING btree ("estado","solicitado_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_solicitudes_entidad" ON "solicitudes_cambio" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_solicitudes_una_pendiente" ON "solicitudes_cambio" USING btree ("entidad","entidad_id") WHERE estado = 'pendiente';--> statement-breakpoint
CREATE INDEX "idx_historial_entidad" ON "historial" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "idx_adjuntos_permiso" ON "adjuntos" USING btree ("permiso_id");