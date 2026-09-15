/**
 * Queries keep snake_case aliases (readable next to the Spanish column
 * names), while the API speaks camelCase. These helpers convert at the
 * response boundary so the frontend never sees two naming styles.
 */

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

export function camelizeRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value
  }
  return out
}

export function camelizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(camelizeRow)
}
