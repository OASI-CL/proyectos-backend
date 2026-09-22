import { sql } from 'drizzle-orm'
import { text, timestamp } from 'drizzle-orm/pg-core'

/**
 * ============================================================================
 * EL MODELO DE DATOS — esta carpeta es la única fuente de verdad
 * ============================================================================
 *
 * Cada archivo de `src/db/schema/` describe UNA tabla: sus columnas, sus tipos,
 * sus claves foráneas y sus índices. De acá salen dos cosas, sin escribir nada
 * dos veces:
 *
 *   1. las migraciones SQL, que se generan con `npm run db:generate`
 *   2. los tipos de TypeScript, con `typeof tabla.$inferSelect`
 *
 * Antes el modelo vivía en `db/schema.sql` Y en las migraciones Y en interfaces
 * escritas a mano: tres lugares para el mismo dato, sincronizados a mano. Si
 * alguien se olvidaba de uno, una base nueva y una migrada quedaban distintas
 * sin que nada avisara.
 *
 * REGLAS (vienen de claude_instructions.md)
 *   - Toda tabla tiene `id` autoincremental como clave primaria. El
 *     identificador del Excel va aparte, en `id_excel`, y es solo para mostrar:
 *     NUNCA se usa como clave foránea.
 *   - Las tablas mutables llevan auditoría (ver `auditoria` abajo).
 *   - Ningún valor calculado se guarda en una columna: los días de
 *     tramitación, los conteos y el semáforo viven en las vistas.
 *   - Todo vocabulario controlado (región, sector, etapa, estado) es una tabla
 *     de catálogo con id, no texto libre.
 *
 * QUÉ NO ESTÁ ACÁ
 * Las vistas, los triggers, la extensión pg_trgm y los datos de los catálogos
 * no se pueden expresar en el modelo: viven en migraciones escritas a mano
 * (`db/migrations/*_custom.sql`). Es la práctica recomendada de Drizzle.
 */

/**
 * Columnas de auditoría, iguales en toda tabla que se pueda modificar.
 *
 * `created_by` / `updated_by` guardan el `sub` de Cognito de quien lo hizo.
 * `updated_at` lo escribe el trigger `set_updated_at()`, nunca la aplicación.
 */
export const auditoria = {
  created_by: text('created_by'),
  updated_by: text('updated_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/** Índice GIN de trigramas: búsquedas por texto parcial (ILIKE '%algo%'). */
export const trigramas = (columna: string) => sql.raw(`${columna} gin_trgm_ops`)
