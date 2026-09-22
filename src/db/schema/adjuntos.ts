import { bigint, bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { permisos } from './permisos'

/**
 * Los archivos adjuntos de un permiso. Acá va SOLO la metadata: el archivo
 * vive en S3 y el navegador lo sube y lo baja directo con una URL prefirmada,
 * sin pasar por la Lambda.
 */
export const adjuntos = pgTable(
  'adjuntos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    permiso_id: bigint('permiso_id', { mode: 'number' })
      .notNull()
      .references(() => permisos.id, { onDelete: 'cascade' }),
    /** Nombre original, el que ve la persona al descargar. */
    nombre_archivo: text('nombre_archivo').notNull(),
    /** Ruta dentro del bucket. */
    s3_key: text('s3_key').notNull(),
    content_type: text('content_type'),
    size_bytes: bigint('size_bytes', { mode: 'number' }),
    /** `sub` de Cognito de quien lo subió. */
    uploaded_by: text('uploaded_by').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('idx_adjuntos_permiso').on(tabla.permiso_id)],
)

export type Adjunto = typeof adjuntos.$inferSelect
export type AdjuntoNuevo = typeof adjuntos.$inferInsert
