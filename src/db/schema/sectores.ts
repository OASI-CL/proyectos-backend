import { bigserial, integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Sectores productivos de los proyectos (Energía, Minería, ...).
 *
 * Los datos están en `db/seed_catalogos.py` (SECTORES). Las variantes con
 * que la planilla escribe algunos (`Infraestructura` -> `Infraestructura /
 * Obras públicas`, `Otros` -> `Otro`, ...) están en SECTOR_ALIAS, en el mismo
 * archivo.
 */
export const sectores = pgTable('sectores', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nombre: text('nombre').notNull().unique(),
  /** Orden de presentación en los dropdowns y los gráficos. */
  orden: integer('orden').notNull().default(0),
})

export type Sector = typeof sectores.$inferSelect
export type SectorNuevo = typeof sectores.$inferInsert
