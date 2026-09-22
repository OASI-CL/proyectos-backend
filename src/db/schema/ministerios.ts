import { bigserial, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Los ministerios del Estado. Cada organismo pertenece a uno.
 *
 * Los datos van en una migración y no salen del Excel: es el organigrama del
 * Estado, no información de un proyecto. Solo cambia con una reforma
 * administrativa.
 */
export const ministerios = pgTable('ministerios', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nombre: text('nombre').notNull().unique(),
  /** Sigla habitual (MOP, MINVU, ...). NULL en 'Municipalidades'. */
  sigla: text('sigla'),
})

export type Ministerio = typeof ministerios.$inferSelect
export type MinisterioNuevo = typeof ministerios.$inferInsert
