import { sql } from 'drizzle-orm'
import { bigint, bigserial, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Quién cambió qué y cuándo, campo por campo. Lo escribe el backend en cada
 * UPDATE, dentro de la misma transacción que el cambio
 * (`src/services/historial.ts`).
 *
 * Los valores se guardan como texto legible, no como ids: si cambia la región
 * de un proyecto, acá dice "Antofagasta -> Atacama" y no "3 -> 4".
 *
 * `entidadId` no es clave foránea por el mismo motivo que en
 * `solicitudes_cambio`: apunta a distintas tablas según `entidad`.
 */
export const historial = pgTable(
  'historial',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entidad: text('entidad').notNull(),
    entidad_id: bigint('entidad_id', { mode: 'number' }).notNull(),
    campo: text('campo').notNull(),
    valor_anterior: text('valor_anterior'),
    valor_nuevo: text('valor_nuevo'),
    /** `sub` de Cognito de quien hizo el cambio. */
    usuario_sub: text('usuario_sub').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [
    check('historial_entidad_check', sql`${tabla.entidad} IN ('proyecto', 'permiso', 'empresa')`),
    index('idx_historial_entidad').on(tabla.entidad, tabla.entidad_id),
  ],
)

export type Historial = typeof historial.$inferSelect
export type HistorialNuevo = typeof historial.$inferInsert
