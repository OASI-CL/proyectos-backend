import { bigserial, date, integer, pgTable } from 'drizzle-orm/pg-core'
import { auditoria } from './comun'

/**
 * Las sesiones del comité de permisos. Se las nombra por su número
 * ("el comité 13"), que es único.
 *
 * OJO con el conteo (migración 003): la tabla del comité N son los permisos
 * que entraron en comités ANTERIORES a N, recalculados a la fecha de N. Es
 * acumulativo y estricto. Ver `src/models/comites.ts`.
 */
export const comites = pgTable('comites', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  numero: integer('numero').notNull().unique(),
  fecha: date('fecha', { mode: 'string' }).notNull(),
  ...auditoria,
})

export type Comite = typeof comites.$inferSelect
export type ComiteNuevo = typeof comites.$inferInsert
