import { sql } from 'drizzle-orm'
import { bigserial, boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { auditoria, trigramas } from './comun'

/**
 * Las empresas titulares de los proyectos.
 *
 * Se cargan desde el Excel (traen `idExcel` tipo 'E100'), pero también se
 * pueden crear desde la app, y en ese caso `idExcel` queda NULL.
 *
 * El alcance del rol `empresa` se apoya en esta tabla: un usuario de BHP solo
 * ve los proyectos cuyo `empresa_id` es BHP.
 */
export const empresas = pgTable(
  'empresas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 'E100', etc. NULL si la creó la app. Solo para mostrar. */
    id_excel: text('id_excel'),
    /** Nombre con el que se la conoce. */
    nombre: text('nombre').notNull(),
    /** Nombre legal, si difiere del anterior. */
    razon_social: text('razon_social'),
    rut: text('rut'),
    email_contacto: text('email_contacto'),
    telefono_contacto: text('telefono_contacto'),
    /** false = no se ofrece al crear proyectos nuevos, pero sus datos quedan. */
    activa: boolean('activa').notNull().default(true),
    ...auditoria,
  },
  (tabla) => [
    // Parcial: varias empresas creadas desde la app pueden tener idExcel NULL,
    // pero un id del Excel no puede repetirse.
    uniqueIndex('idx_empresas_id_excel').on(tabla.id_excel).where(sql`id_excel IS NOT NULL`),
    index('idx_empresas_nombre_trgm').using('gin', trigramas('nombre')),
  ],
)

export type Empresa = typeof empresas.$inferSelect
export type EmpresaNueva = typeof empresas.$inferInsert
