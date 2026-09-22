import { bigserial, integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Las 16 regiones de Chile, más dos pseudo-regiones que trae el Excel origen
 * (`Interregional` para proyectos que cruzan varias, y `Nivel Central` para
 * los que se tramitan sin región).
 *
 * Los datos van en una migración: los ids son fijos y tienen que significar
 * lo mismo en la base local, en dev y en prod (`region_id = 3` es Antofagasta
 * en las tres).
 *
 * `id` sigue el orden geográfico norte -> sur, que es el orden en que se
 * muestran. `numero` es el número oficial de la división política.
 */
export const regiones = pgTable('regiones', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** Número oficial de la región. NULL en las dos pseudo-regiones. */
  numero: integer('numero').unique(),
  /** Numeral romano ('II', 'RM', ...). NULL en las dos pseudo-regiones. */
  codigo: text('codigo'),
  /** Nombre corto: el que se muestra y el que trae el Excel. */
  nombre: text('nombre').notNull().unique(),
  /** Nombre largo, para informes formales. */
  nombre_oficial: text('nombre_oficial'),
})

export type Region = typeof regiones.$inferSelect
export type RegionNueva = typeof regiones.$inferInsert
