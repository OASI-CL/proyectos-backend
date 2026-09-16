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
 * Campos que en la tabla son una FK a un catálogo pero que en el historial
 * tienen que quedar LEGIBLES.
 *
 * Sin esto el log de cambios diría "region_id: 3 -> 7", que no le dice nada a
 * nadie. Con esto dice "region: Antofagasta -> Metropolitana". Se guarda el
 * nombre del campo sin el sufijo _id y los valores resueltos a nombre.
 *
 * El nombre de tabla NO sale de la entrada del usuario: son estas constantes,
 * así que interpolarlo en el SELECT es seguro.
 */
const CAMPOS_CATALOGO: Record<string, { tabla: string; campo: string }> = {
  region_id: { tabla: 'regiones', campo: 'region' },
  sector_id: { tabla: 'sectores', campo: 'sector' },
  etapa_id: { tabla: 'etapas_proyecto', campo: 'etapa' },
  estado_id: { tabla: 'estados_permiso', campo: 'estado' },
  estado_snapshot_id: { tabla: 'estados_permiso', campo: 'estado_snapshot' },
}

/**
 * Traduce un id de catálogo a su nombre. Si el id no existe (o es NULL)
 * devuelve null, que es exactamente lo que el historial guarda para "vacío".
 */
async function nombreDeCatalogo(
  client: PoolClient,
  tabla: string,
  id: string | null,
): Promise<string | null> {
  if (id === null) return null
  const { rows } = await client.query(`SELECT nombre FROM ${tabla} WHERE id = $1`, [id])
  return rows[0]?.nombre ?? id
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

    const idAnterior = normalizar(anterior[campo])
    const idNuevo = normalizar(nuevo[campo])
    // La comparación se hace sobre los ids (no sobre los nombres): es exacta
    // y evita resolver el catálogo cuando no hubo cambio real.
    if (idAnterior === idNuevo) continue

    const catalogo = CAMPOS_CATALOGO[campo]
    const campoLog = catalogo ? catalogo.campo : campo
    const valorAnterior = catalogo
      ? await nombreDeCatalogo(client, catalogo.tabla, idAnterior)
      : idAnterior
    const valorNuevo = catalogo
      ? await nombreDeCatalogo(client, catalogo.tabla, idNuevo)
      : idNuevo

    await client.query(
      `INSERT INTO historial (entidad, entidad_id, campo, valor_anterior, valor_nuevo, usuario_sub)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entidad, entidadId, campoLog, valorAnterior, valorNuevo, usuarioSub],
    )
    cambios++
  }

  return cambios
}
