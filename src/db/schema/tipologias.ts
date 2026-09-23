import { bigint, bigserial, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { sectores } from './sectores'

/**
 * Subclasificación de un proyecto dentro de su sector (ej. sector Minería ->
 * tipología "Minería Cobre"). Viene de la hoja "Sector-Tipología" que arma
 * OASI como taxonomía de referencia.
 *
 * Al 22-09-2026 ningún proyecto tiene todavía una tipología cargada
 * (`proyectos.tipologia_id` es NULL en los 326): el catálogo se carga igual
 * porque la hoja ya lo define, para que esté listo cuando empiecen a
 * completarlo.
 */
export const tipologias = pgTable(
  'tipologias',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sectorId: bigint('sector_id', { mode: 'number' })
      .notNull()
      .references(() => sectores.id),
    nombre: text('nombre').notNull(),
  },
  (tabla) => [unique('tipologias_nombre_unique').on(tabla.nombre)],
)

export type Tipologia = typeof tipologias.$inferSelect
export type TipologiaNueva = typeof tipologias.$inferInsert
