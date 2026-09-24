import { sql } from 'drizzle-orm'
import { bigint, bigserial, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { auditoria, trigramas } from './comun'
import { empresas } from './empresas'

/**
 * Los TITULARES: la sociedad (razón social) que tramita los permisos de un
 * proyecto ante el organismo. Ej. "Minera Centinela", "GR Pacama SpA".
 *
 * No confundir con la EMPRESA (tabla `empresas`): el grupo que está detrás y
 * que quiere sacar el proyecto adelante. Una empresa tiene muchos titulares
 * — AMSA opera con "Minera Centinela", "Minera Los Pelambres", "Compañía
 * Minera Zaldívar SpA", ... —, y cada proyecto tiene UN titular.
 *
 * Se cargan desde el Excel (`db/cargar_excel.py`): hoja "Titular-Empresa"
 * (qué titular pertenece a qué empresa) + columna "titular" de "Proyectos".
 * Van creciendo con cada planilla nueva.
 *
 * Clave natural: `nombre_normalizado` (el nombre en minúsculas, sin tildes ni
 * signos). Es lo que usa la carga para decidir si un titular ya existe o es
 * nuevo, así "Minera Centinela" y "Minera Centinela." son el mismo.
 */
export const titulares = pgTable(
  'titulares',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Nombre tal como viene en la planilla (el primero que se vio). */
    nombre: text('nombre').notNull(),
    /** Clave de la carga incremental. Ver `normalizar()` en db/cargar_excel.py. */
    nombre_normalizado: text('nombre_normalizado'),
    /**
     * Empresa (grupo) a la que pertenece, según la hoja "Titular-Empresa".
     * NULL si la hoja no lo dice. Es informativo: la empresa de un PROYECTO
     * se guarda en `proyectos.empresa_id`, que manda.
     */
    empresa_id: bigint('empresa_id', { mode: 'number' }).references(() => empresas.id),
    ...auditoria,
  },
  (tabla) => [
    uniqueIndex('idx_titulares_nombre_normalizado')
      .on(tabla.nombre_normalizado)
      .where(sql`nombre_normalizado IS NOT NULL`),
    index('idx_titulares_empresa').on(tabla.empresa_id),
    index('idx_titulares_nombre_trgm').using('gin', trigramas('nombre')),
  ],
)

export type Titular = typeof titulares.$inferSelect
export type TitularNuevo = typeof titulares.$inferInsert
