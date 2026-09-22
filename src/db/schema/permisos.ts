import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { auditoria, trigramas } from './comun'
import { estadosPermiso } from './estadosPermiso'
import { organismos } from './organismos'
import { proyectos } from './proyectos'

/**
 * Los permisos sectoriales: el corazón del sistema. Cada permiso pertenece a
 * un proyecto y lo tramita un organismo.
 *
 * Nada calculado se guarda acá. Los días de tramitación, el semáforo y los
 * tramos (menos de 3 meses / 3 a 6 / más de 6) los da la vista `v_permisos`,
 * siempre contra la fecha de hoy.
 */
export const permisos = pgTable(
  'permisos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 'PM1377', etc. Solo para mostrar. */
    id_excel: text('id_excel'),
    proyecto_id: bigint('proyecto_id', { mode: 'number' })
      .notNull()
      .references(() => proyectos.id, { onDelete: 'cascade' }),
    organismo_id: bigint('organismo_id', { mode: 'number' })
      .notNull()
      .references(() => organismos.id),
    nombre: text('nombre').notNull(),
    /** 'Nombre Permiso Estándar' del Excel. 35 permisos solo traen este. */
    nombre_estandar: text('nombre_estandar'),
    /** Texto libre: muy heterogéneo en el Excel origen. */
    tipo_permiso: text('tipo_permiso'),
    n_expediente: text('n_expediente'),
    /**
     * 'Es crítico (Si/No)' del Excel: viene vacío en TODAS las filas, así que
     * se cargó en false. Hay que marcarlos a mano desde la app.
     */
    critico: boolean('critico').notNull().default(false),
    /** Construcción / operación / acceso al terreno / otro. */
    que_habilita: text('que_habilita'),
    /** Dato sucio en origen (Si/si/SI/2/textos largos); lo dudoso quedó false. */
    habilitante_construccion: boolean('habilitante_construccion').notNull().default(false),
    /** 1 = Pendiente. El id es estable porque el catálogo va en una migración. */
    estado_id: bigint('estado_id', { mode: 'number' })
      .notNull()
      .default(1)
      .references(() => estadosPermiso.id),
    fecha_ingreso: date('fecha_ingreso', { mode: 'string' }),
    fecha_resolucion_estimada: date('fecha_resolucion_estimada', { mode: 'string' }),
    fecha_resolucion: date('fecha_resolucion', { mode: 'string' }),
    /** 'Favorable' | 'No favorable' | libre (dato sucio en origen). */
    tipo_resolucion: text('tipo_resolucion'),
    hito_tramitacion: text('hito_tramitacion'),
    incluido_catastro_hacienda: boolean('incluido_catastro_hacienda'),
    n_catastro: text('n_catastro'),
    observaciones: text('observaciones'),
    /** Ver el mismo campo en `proyectos`. */
    estado_validacion: text('estado_validacion').notNull().default('validado'),

    // --- Columnas de la planilla "Levantamiento de Permisos" (22-09-2026) ---
    /** Si el permiso está dentro del universo de seguimiento activo de OASI. */
    en_universo: boolean('en_universo'),
    fecha_registro_catastro: date('fecha_registro_catastro', { mode: 'string' }),
    /**
     * Cuándo y quién del equipo lo actualizó por última vez EN LA PLANILLA
     * origen (nombres de pila: "Victoria", "Coni", "Flo", ...). No es lo
     * mismo que `updated_by`/`updated_at`: esos los pone el trigger de
     * auditoría cuando alguien edita desde la app, con el sub de Cognito.
     * Este par es el registro manual previo, tal como venía en el Excel.
     */
    fecha_actualizacion: date('fecha_actualizacion', { mode: 'string' }),
    quien_actualizo: text('quien_actualizo'),

    ...auditoria,
  },
  (tabla) => [
    check(
      'permisos_estado_validacion_check',
      sql`${tabla.estado_validacion} IN ('borrador', 'en_revision', 'validado')`,
    ),
    uniqueIndex('idx_permisos_id_excel').on(tabla.id_excel).where(sql`id_excel IS NOT NULL`),
    index('idx_permisos_proyecto').on(tabla.proyecto_id),
    index('idx_permisos_organismo').on(tabla.organismo_id),
    index('idx_permisos_estado').on(tabla.estado_id),
    index('idx_permisos_nombre_trgm').using('gin', trigramas('nombre')),
  ],
)

export type Permiso = typeof permisos.$inferSelect
export type PermisoNuevo = typeof permisos.$inferInsert
