/**
 * Queries keep snake_case aliases (readable next to the Spanish column
 * names), while the API speaks camelCase. These helpers convert at the
 * response boundary so the frontend never sees two naming styles.
 */

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

// `object` rather than Record<string, unknown>: rows now come back typed as
// the model interfaces (VUsuario, VProyecto, ...), which have no index
// signature and so would not satisfy Record<string, unknown>.
export function camelizeRow(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value
  }
  return out
}

export function camelizeRows(rows: object[]): Record<string, unknown>[] {
  return rows.map(camelizeRow)
}
