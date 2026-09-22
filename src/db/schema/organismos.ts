import { bigint, bigserial, index, pgTable, text } from 'drizzle-orm/pg-core'
import { ministerios } from './ministerios'

/**
 * Los organismos que tramitan permisos (CONAF, DGA, SEA, ...).
 *
 * `nombre` es la sigla con la que se los conoce y es la que se muestra;
 * `nombreLargo` es el nombre completo, para informes.
 *
 * El alcance del rol `organismo` se apoya en esta tabla: un usuario de CONAF
 * solo ve los permisos cuyo `organismo_id` es CONAF.
 */
export const organismos = pgTable(
  'organismos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Sigla tal como viene del Excel. Solo para mostrar, nunca clave foránea. */
    id_excel: text('id_excel'),
    nombre: text('nombre').notNull().unique(),
    nombre_largo: text('nombre_largo'),
    ministerio_id: bigint('ministerio_id', { mode: 'number' })
      .notNull()
      .references(() => ministerios.id),
  },
  (tabla) => [index('idx_organismos_ministerio').on(tabla.ministerio_id)],
)

export type Organismo = typeof organismos.$inferSelect
export type OrganismoNuevo = typeof organismos.$inferInsert
