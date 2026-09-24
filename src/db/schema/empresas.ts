import { sql } from 'drizzle-orm'
import { bigserial, boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { auditoria, trigramas } from './comun'

/**
 * Las EMPRESAS: el grupo que quiere sacar adelante el proyecto (BHP, CODELCO,
 * Grenergy, ...). No confundir con el TITULAR (tabla `titulares`): la razón
 * social que tramita los permisos. Una empresa tiene varios titulares.
 *
 * Se cargan desde el Excel (`db/cargar_excel.py`, columna "empresa" de la
 * hoja "Proyectos" + hoja "Titular-Empresa") y también se pueden crear desde
 * la app.
 *
 * IDENTIDAD = el NOMBRE, no el código "E###" de la planilla. Ese código no es
 * confiable: la misma empresa aparece con varios (Grenergy: E058, E059, E060,
 * E061, E098) y un mismo código aparece en empresas distintas (E060 = Akuo
 * Energy y Grenergy; E098 = Biwo y Grenergy). Agrupar por código fue lo que
 * dejó cientos de proyectos mal asignados. Por eso la carga usa
 * `nombre_normalizado` como clave y deja `id_excel` en NULL.
 *
 * El alcance del rol `empresa` se apoya en esta tabla: un usuario de BHP solo
 * ve los proyectos cuyo `empresa_id` es BHP.
 */
export const empresas = pgTable(
  'empresas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /**
     * Código "E###" de la planilla. La carga desde el Excel NO lo llena (ver
     * arriba: el código no identifica a la empresa). Queda por compatibilidad.
     */
    id_excel: text('id_excel'),
    /** Nombre con el que se la conoce (columna "empresa" / "Nombre empresa"). */
    nombre: text('nombre').notNull(),
    /**
     * Clave de la carga incremental: el nombre en minúsculas, sin tildes, sin
     * signos y sin "S.A."/"SpA"/"Ltda" al final ("Colbún" = "Colbun S.A.").
     * Ver `normalizar_empresa()` en db/cargar_excel.py. NULL en empresas
     * creadas desde la app.
     */
    nombre_normalizado: text('nombre_normalizado'),
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
    uniqueIndex('idx_empresas_nombre_normalizado')
      .on(tabla.nombre_normalizado)
      .where(sql`nombre_normalizado IS NOT NULL`),
    index('idx_empresas_nombre_trgm').using('gin', trigramas('nombre')),
  ],
)

export type Empresa = typeof empresas.$inferSelect
export type EmpresaNueva = typeof empresas.$inferInsert
