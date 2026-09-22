import { bigserial, integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Sectores productivos de los proyectos (Energía, Minería, ...).
 *
 * El catálogo sale de lo que efectivamente trae el Excel origen, ya limpiado:
 * dos variantes sucias se consolidan al cargar los datos (ver `db/seed.py`),
 * `Infraestructura` -> `Infraestructura / Obras públicas` y
 * `Energía / Infraestructura` -> `Energía`.
 */
export const sectores = pgTable('sectores', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  nombre: text('nombre').notNull().unique(),
  /** Orden de presentación en los dropdowns y los gráficos. */
  orden: integer('orden').notNull().default(0),
})

export type Sector = typeof sectores.$inferSelect
export type SectorNuevo = typeof sectores.$inferInsert
