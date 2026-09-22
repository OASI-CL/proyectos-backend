import { bigint, bigserial, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { comites } from './comites'
import { estadosPermiso } from './estadosPermiso'
import { permisos } from './permisos'

/**
 * Relación N:N entre permisos y sesiones de comité: en qué sesión entró cada
 * permiso al seguimiento.
 *
 * El Excel origen solo guarda el comité ACTUAL de cada permiso, así que hoy
 * cada permiso tiene exactamente un vínculo. El modelo admite varios para
 * cuando el historial completo se arme con el uso real de la app.
 *
 * Los `*Snapshot` congelaban cómo estaba el permiso el día de esa sesión.
 * Desde la migración 003 las vistas no los usan (cada permiso se muestra en
 * las sesiones posteriores a la suya y todo se recalcula a la fecha de la
 * sesión que se mira). Quedan por si vuelve a hacer falta el dato congelado.
 */
export const permisosComite = pgTable(
  'permisos_comite',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    permiso_id: bigint('permiso_id', { mode: 'number' })
      .notNull()
      .references(() => permisos.id, { onDelete: 'cascade' }),
    comite_id: bigint('comite_id', { mode: 'number' })
      .notNull()
      .references(() => comites.id, { onDelete: 'cascade' }),
    estado_snapshot_id: bigint('estado_snapshot_id', { mode: 'number' }).references(
      () => estadosPermiso.id,
    ),
    dias_snapshot: integer('dias_snapshot'),
    /** Compromiso asumido en esa sesión. */
    compromiso: text('compromiso'),
  },
  (tabla) => [
    unique('permisos_comite_permiso_id_comite_id_key').on(tabla.permiso_id, tabla.comite_id),
    index('idx_permisos_comite_permiso').on(tabla.permiso_id),
    index('idx_permisos_comite_comite').on(tabla.comite_id),
  ],
)

export type PermisoComite = typeof permisosComite.$inferSelect
export type PermisoComiteNuevo = typeof permisosComite.$inferInsert
