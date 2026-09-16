import type { PoolClient } from 'pg'
import { pool } from '../db/client'
import { registrarCambios } from './historial'
import type { UsuarioAutenticado } from '../middleware/auth'
import type { EntidadSolicitud } from '../shared/types'

/**
 * Change-request workflow.
 *
 * Roles that need approval (empresa, organismo) never write straight to
 * proyectos/permisos — their edits are stored as a proposal and OASI applies
 * or rejects them. That keeps the live tables trustworthy for the reports:
 * a number on the dashboard is always something OASI has accepted.
 *
 * Two kinds of request:
 *   'creacion' — the row already exists with estado_validacion='en_revision'.
 *                Approving flips it to 'validado'; rejecting leaves it out of
 *                the validated universe (it is not deleted, so the submitter
 *                does not silently lose their work).
 *   'edicion'  — `cambios` holds the proposed values. Approving applies them
 *                and writes the usual historial rows, inside one transaction.
 */

/** Columns a change request is allowed to touch, per entity. */
const CAMPOS_EDITABLES: Record<EntidadSolicitud, string[]> = {
  permiso: [
    'nombre', 'nombre_estandar', 'tipo_permiso', 'n_expediente', 'critico',
    'que_habilita', 'habilitante_construccion', 'estado', 'fecha_ingreso',
    'fecha_resolucion_estimada', 'fecha_resolucion', 'tipo_resolucion',
    'hito_tramitacion', 'incluido_catastro_hacienda', 'n_catastro', 'observaciones',
  ],
  proyecto: [
    'nombre', 'titular', 'region', 'sector', 'inversion_mmusd',
    'empleo_construccion', 'empleo_operacion', 'estado_ambiental', 'etapa',
    'fecha_inicio_construccion', 'fecha_inicio_operacion', 'observaciones_oasi',
  ],
}

const TABLA: Record<EntidadSolicitud, string> = {
  proyecto: 'proyectos',
  permiso: 'permisos',
}

/** Keeps only the fields that entity actually allows editing. */
export function filtrarCamposEditables(
  entidad: EntidadSolicitud,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const permitidos = CAMPOS_EDITABLES[entidad]
  const cambios: Record<string, unknown> = {}
  for (const campo of permitidos) {
    if (Object.prototype.hasOwnProperty.call(body, campo)) {
      cambios[campo] = body[campo] === '' ? null : body[campo]
    }
  }
  return cambios
}

export class ApprovalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Queues an edit for review. Fails if the entity already has an open request,
 * so two people cannot stack conflicting edits on the same row (the DB has a
 * partial unique index backing this up).
 */
export async function crearSolicitudEdicion(
  entidad: EntidadSolicitud,
  entidadId: number,
  cambios: Record<string, unknown>,
  user: UsuarioAutenticado,
  comentario?: string,
) {
  const abierta = await pool.query(
    `SELECT id FROM solicitudes_cambio
      WHERE entidad = $1 AND entidad_id = $2 AND estado = 'pendiente'`,
    [entidad, entidadId],
  )

  if (abierta.rows.length > 0) {
    throw new ApprovalError(
      409,
      'solicitud_abierta',
      'Ya hay una solicitud de cambio pendiente de revisión para este registro.',
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO solicitudes_cambio (entidad, entidad_id, tipo, cambios, comentario, solicitado_por)
     VALUES ($1, $2, 'edicion', $3::jsonb, $4, $5)
     RETURNING *`,
    [entidad, entidadId, JSON.stringify(cambios), comentario ?? null, user.sub],
  )
  return rows[0]
}

/**
 * Records that a newly created row is waiting for validation, so it shows up
 * in the same approvals queue as the edits.
 */
export async function crearSolicitudCreacion(
  client: PoolClient,
  entidad: EntidadSolicitud,
  entidadId: number,
  user: UsuarioAutenticado,
) {
  await client.query(
    `INSERT INTO solicitudes_cambio (entidad, entidad_id, tipo, solicitado_por)
     VALUES ($1, $2, 'creacion', $3)
     ON CONFLICT DO NOTHING`,
    [entidad, entidadId, user.sub],
  )
}

/**
 * Applies a pending request and closes it. Everything happens in one
 * transaction: the row update, the historial diff and the request status.
 */
export async function aprobarSolicitud(
  solicitudId: number,
  user: UsuarioAutenticado,
  comentarioRevision?: string,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // FOR UPDATE: two reviewers clicking approve at the same time must not
    // both apply the change.
    const solicitudRes = await client.query(
      `SELECT * FROM solicitudes_cambio WHERE id = $1 FOR UPDATE`,
      [solicitudId],
    )
    const solicitud = solicitudRes.rows[0]

    if (!solicitud) {
      throw new ApprovalError(404, 'no_encontrado', 'Solicitud no encontrada')
    }
    if (solicitud.estado !== 'pendiente') {
      throw new ApprovalError(
        409,
        'ya_revisada',
        `Esta solicitud ya fue ${solicitud.estado === 'aprobada' ? 'aprobada' : 'rechazada'}.`,
      )
    }

    const entidad = solicitud.entidad as EntidadSolicitud
    const tabla = TABLA[entidad]

    const previoRes = await client.query(`SELECT * FROM ${tabla} WHERE id = $1`, [
      solicitud.entidad_id,
    ])
    const anterior = previoRes.rows[0]
    if (!anterior) {
      throw new ApprovalError(
        410,
        'entidad_eliminada',
        'El registro asociado a esta solicitud ya no existe.',
      )
    }

    if (solicitud.tipo === 'creacion') {
      // Nothing to merge: the row is already there, it just was not validated.
      await client.query(
        `UPDATE ${tabla} SET estado_validacion = 'validado', updated_by = $1 WHERE id = $2`,
        [user.sub, solicitud.entidad_id],
      )
      await registrarCambios(
        client,
        entidad,
        solicitud.entidad_id,
        { estado_validacion: anterior.estado_validacion },
        { estado_validacion: 'validado' },
        user.sub,
      )
    } else {
      const cambios = (solicitud.cambios ?? {}) as Record<string, unknown>
      const campos = Object.keys(cambios).filter((campo) =>
        CAMPOS_EDITABLES[entidad].includes(campo),
      )

      if (campos.length > 0) {
        const sets = campos.map((campo, i) => `${campo} = $${i + 1}`)
        const valores: unknown[] = campos.map((campo) => cambios[campo])
        valores.push(user.sub, solicitud.entidad_id)

        await client.query(
          `UPDATE ${tabla}
              SET ${sets.join(', ')},
                  estado_validacion = 'validado',
                  updated_by = $${valores.length - 1}
            WHERE id = $${valores.length}`,
          valores,
        )

        const aplicados: Record<string, unknown> = {}
        for (const campo of campos) aplicados[campo] = cambios[campo]
        await registrarCambios(client, entidad, solicitud.entidad_id, anterior, aplicados, user.sub)
      }
    }

    const cerrada = await client.query(
      `UPDATE solicitudes_cambio
          SET estado = 'aprobada', revisado_por = $1, revisado_at = now(),
              comentario_revision = $2
        WHERE id = $3
        RETURNING *`,
      [user.sub, comentarioRevision ?? null, solicitudId],
    )

    await client.query('COMMIT')
    return cerrada.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Closes a request without applying it.
 *
 * A rejected 'creacion' leaves the row as 'borrador': it stays out of every
 * validated report but the submitter does not lose what they typed, and OASI
 * can explain why in comentario_revision.
 */
export async function rechazarSolicitud(
  solicitudId: number,
  user: UsuarioAutenticado,
  comentarioRevision?: string,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const solicitudRes = await client.query(
      `SELECT * FROM solicitudes_cambio WHERE id = $1 FOR UPDATE`,
      [solicitudId],
    )
    const solicitud = solicitudRes.rows[0]

    if (!solicitud) {
      throw new ApprovalError(404, 'no_encontrado', 'Solicitud no encontrada')
    }
    if (solicitud.estado !== 'pendiente') {
      throw new ApprovalError(
        409,
        'ya_revisada',
        `Esta solicitud ya fue ${solicitud.estado === 'aprobada' ? 'aprobada' : 'rechazada'}.`,
      )
    }

    if (solicitud.tipo === 'creacion') {
      await client.query(
        `UPDATE ${TABLA[solicitud.entidad as EntidadSolicitud]}
            SET estado_validacion = 'borrador', updated_by = $1
          WHERE id = $2`,
        [user.sub, solicitud.entidad_id],
      )
    }

    const cerrada = await client.query(
      `UPDATE solicitudes_cambio
          SET estado = 'rechazada', revisado_por = $1, revisado_at = now(),
              comentario_revision = $2
        WHERE id = $3
        RETURNING *`,
      [user.sub, comentarioRevision ?? null, solicitudId],
    )

    await client.query('COMMIT')
    return cerrada.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
