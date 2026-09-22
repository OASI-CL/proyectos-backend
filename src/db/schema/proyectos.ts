import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { auditoria, trigramas } from './comun'
import { empresas } from './empresas'
import { etapasProyecto } from './etapasProyecto'
import { regiones } from './regiones'
import { sectores } from './sectores'
import { tipologias } from './tipologias'

/**
 * Los proyectos de inversión que se siguen. Cada uno tiene N permisos.
 *
 * Nada calculado se guarda acá: los conteos de permisos (total, pendientes,
 * atrasados) los da la vista `v_proyectos`.
 */
export const proyectos = pgTable(
  'proyectos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 'P183', etc. NULL si lo creó la app. Solo para mostrar. */
    id_excel: text('id_excel'),
    nombre: text('nombre').notNull(),
    /** Razón social del titular; puede diferir del nombre de la empresa. */
    titular: text('titular'),
    empresa_id: bigint('empresa_id', { mode: 'number' })
      .notNull()
      .references(() => empresas.id),
    region_id: bigint('region_id', { mode: 'number' }).references(() => regiones.id),
    sector_id: bigint('sector_id', { mode: 'number' }).references(() => sectores.id),
    /** Subclasificación dentro del sector. Ver `db/schema/tipologias.ts`. */
    tipologia_id: bigint('tipologia_id', { mode: 'number' }).references(() => tipologias.id),
    etapa_id: bigint('etapa_id', { mode: 'number' }).references(() => etapasProyecto.id),
    inversion_mmusd: numeric('inversion_mmusd', { mode: 'number' }),
    empleo_construccion: integer('empleo_construccion'),
    empleo_operacion: integer('empleo_operacion'),
    /**
     * Estado ambiental (RCA), ej. 'RCA aprobada'. Texto libre y CASI VACÍO en
     * el Excel origen: 314 de 317 proyectos no lo traen. Se clasifica con
     * ILIKE en `src/db/sql.ts` (rcaStatusSql).
     */
    estado_ambiental: text('estado_ambiental'),
    fecha_inicio_construccion: date('fecha_inicio_construccion', { mode: 'string' }),
    fecha_inicio_operacion: date('fecha_inicio_operacion', { mode: 'string' }),
    /** '¿Habilitantes Aprobado?' del Excel origen. */
    habilitantes_aprobado: boolean('habilitantes_aprobado'),
    /** Ingreso del proyecto al universo OASI (no al trámite de un permiso). */
    fecha_ingreso: date('fecha_ingreso', { mode: 'string' }),
    fecha_ultima_resolucion: date('fecha_ultima_resolucion', { mode: 'string' }),
    observaciones_oasi: text('observaciones_oasi'),
    /**
     * Solo 'validado' entra a los reportes. Lo que crea una empresa o un
     * organismo nace 'en_revision' hasta que OASI lo aprueba; un rechazo lo
     * deja en 'borrador' (no se borra, para que nadie pierda su trabajo).
     */
    estado_validacion: text('estado_validacion').notNull().default('validado'),

    // --- Columnas de la planilla "Levantamiento de Permisos" (22-09-2026) ---
    /**
     * 1 o 2 en el Excel origen. Significado exacto sin confirmar con OASI —
     * parece distinguir dos tandas del catastro, pero se guarda tal cual en
     * vez de adivinar. Preguntar antes de usarlo en un reporte.
     */
    n_catastro: integer('n_catastro'),
    /** Si el proyecto está en el catastro de Hacienda (a nivel proyecto; distinto de `permisos.incluido_catastro_hacienda`, que es por permiso). */
    incluido_en_catastro: boolean('incluido_en_catastro'),
    /** Si el proyecto está dentro del universo de seguimiento activo de OASI. */
    en_universo_permisos: boolean('en_universo_permisos'),
    /** Seguimiento de contacto para proyectos ya liberados del catastro. Disperso en el Excel origen (108/326 con dato). */
    sigue_liberado_al_contactar: boolean('sigue_liberado_al_contactar'),
    listado_37_proyectos_liberados: boolean('listado_37_proyectos_liberados'),
    listado_97_proyectos_no_iniciados: boolean('listado_97_proyectos_no_iniciados'),

    ...auditoria,
  },
  (tabla) => [
    check(
      'proyectos_estado_validacion_check',
      sql`${tabla.estado_validacion} IN ('borrador', 'en_revision', 'validado')`,
    ),
    uniqueIndex('idx_proyectos_id_excel').on(tabla.id_excel).where(sql`id_excel IS NOT NULL`),
    index('idx_proyectos_empresa').on(tabla.empresa_id),
    index('idx_proyectos_region').on(tabla.region_id),
    index('idx_proyectos_sector').on(tabla.sector_id),
    index('idx_proyectos_etapa').on(tabla.etapa_id),
    index('idx_proyectos_nombre_trgm').using('gin', trigramas('nombre')),
  ],
)

export type Proyecto = typeof proyectos.$inferSelect
export type ProyectoNuevo = typeof proyectos.$inferInsert
