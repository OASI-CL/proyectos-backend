import type { PoolClient } from 'pg'
import type { EntidadHistorial } from '../shared/types'

/**
 * Campos que nunca se registran en el historial (ruido de auditoría).
 */
const CAMPOS_IGNORADOS = new Set([
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
])

/**
 * Normaliza un valor a texto para poder compararlo y guardarlo.
 * Las fechas quedan en ISO YYYY-MM-DD, los vacíos en NULL.
 */
function normalizar(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (valor instanceof Date) return valor.toISOString().slice(0, 10)
  return String(valor)
}

/**
 * Compara el registro anterior contra el nuevo y escribe una fila en
 * `historial` por cada campo que cambió.
 *
 * IMPORTANTE: recibe un PoolClient (no el pool) porque tiene que correr
 * DENTRO de la misma transacción que el UPDATE.
 */
export async function registrarCambios(
  client: PoolClient,
  entidad: EntidadHistorial,
  entidadId: number,
  anterior: Record<string, unknown>,
  nuevo: Record<string, unknown>,
  usuarioSub: string,
): Promise<number> {
  let cambios = 0

  for (const campo of Object.keys(nuevo)) {
    if (CAMPOS_IGNORADOS.has(campo)) continue

    const valorAnterior = normalizar(anterior[campo])
    const valorNuevo = normalizar(nuevo[campo])
    if (valorAnterior === valorNuevo) continue

    await client.query(
      `INSERT INTO historial (entidad, entidad_id, campo, valor_anterior, valor_nuevo, usuario_sub)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entidad, entidadId, campo, valorAnterior, valorNuevo, usuarioSub],
    )
    cambios++
  }

  return cambios
}
