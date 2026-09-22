import { bigserial, boolean, integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Estado de tramitación de un permiso: Pendiente, Resuelto, Descartado.
 *
 * `esFinal` marca los estados que cierran la tramitación. Existe para que las
 * vistas no tengan que repetir la lista `('Resuelto', 'Descartado')` en cada
 * cálculo: preguntan por el flag. Si mañana se agrega un estado que también
 * cierra, alcanza con marcarlo acá y ninguna vista cambia.
 *
 * Un permiso descartado cuenta como "finalizado" porque su trámite terminó,
 * no porque se haya aprobado.
 */
export const estadosPermiso = pgTable('estados_permiso', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull().unique(),
  es_final: boolean('es_final').notNull().default(false),
  orden: integer('orden').notNull().default(0),
})

export type EstadoPermisoCatalogo = typeof estadosPermiso.$inferSelect
export type EstadoPermisoNuevo = typeof estadosPermiso.$inferInsert
