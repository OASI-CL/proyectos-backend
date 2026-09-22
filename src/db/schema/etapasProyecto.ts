import { bigserial, integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * En qué etapa está un proyecto: no iniciado, en construcción, en operación.
 *
 * `codigo` es la clave estable que usa el código de la app; `nombre` es lo que
 * ve el usuario. Conviene comparar siempre contra `codigo`: cambiar un nombre
 * en pantalla no debería romper una consulta.
 */
export const etapasProyecto = pgTable('etapas_proyecto', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull().unique(),
  /** Avance real del proyecto, para ordenar de menos a más avanzado. */
  orden: integer('orden').notNull().default(0),
})

export type EtapaProyecto = typeof etapasProyecto.$inferSelect
export type EtapaProyectoNueva = typeof etapasProyecto.$inferInsert
