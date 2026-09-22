import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * El flujo de aprobación: las empresas y los organismos no escriben directo en
 * `proyectos` / `permisos`, sus cambios quedan acá como propuesta y OASI los
 * aplica o los rechaza. Así cualquier número del dashboard es algo que OASI
 * aceptó.
 *
 *   tipo = 'creacion'  la fila ya existe con estado_validacion 'en_revision';
 *                      aprobar la pasa a 'validado', rechazar la deja en
 *                      'borrador' (no se borra).
 *   tipo = 'edicion'   `cambios` trae los valores propuestos; aprobar los
 *                      aplica y escribe el historial, todo en una transacción.
 *
 * `entidadId` es un id de otra tabla pero NO es clave foránea: apunta a
 * `proyectos` o a `permisos` según `entidad`, y una FK solo puede apuntar a
 * una tabla. La integridad la sostiene el código (services/approvals.ts).
 */
export const solicitudesCambio = pgTable(
  'solicitudes_cambio',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entidad: text('entidad').notNull(),
    entidad_id: bigint('entidad_id', { mode: 'number' }).notNull(),
    tipo: text('tipo').notNull(),
    /** Los valores propuestos, campo -> valor nuevo. */
    cambios: jsonb('cambios').notNull().default({}),
    estado: text('estado').notNull().default('pendiente'),
    comentario: text('comentario'),
    /** `sub` de Cognito de quien la pidió. */
    solicitado_por: text('solicitado_por').notNull(),
    solicitado_at: timestamp('solicitado_at', { withTimezone: true }).notNull().defaultNow(),
    revisado_por: text('revisado_por'),
    revisado_at: timestamp('revisado_at', { withTimezone: true }),
    comentario_revision: text('comentario_revision'),
  },
  (tabla) => [
    check('solicitudes_cambio_entidad_check', sql`${tabla.entidad} IN ('proyecto', 'permiso')`),
    check('solicitudes_cambio_tipo_check', sql`${tabla.tipo} IN ('creacion', 'edicion')`),
    check(
      'solicitudes_cambio_estado_check',
      sql`${tabla.estado} IN ('pendiente', 'aprobada', 'rechazada')`,
    ),
    index('idx_solicitudes_estado').on(tabla.estado, tabla.solicitado_at.desc()),
    index('idx_solicitudes_entidad').on(tabla.entidad, tabla.entidad_id),
    // Una sola solicitud abierta por registro: evita que dos personas encolen
    // ediciones en conflicto sobre el mismo permiso.
    uniqueIndex('idx_solicitudes_una_pendiente')
      .on(tabla.entidad, tabla.entidad_id)
      .where(sql`estado = 'pendiente'`),
  ],
)

export type SolicitudCambio = typeof solicitudesCambio.$inferSelect
export type SolicitudCambioNueva = typeof solicitudesCambio.$inferInsert
