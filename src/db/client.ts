import { Pool, types } from 'pg'

// ----------------------------------------------------------------------------
// Parsers de tipos
//
// Por defecto `pg` devuelve:
//   - DATE  -> objeto Date de JS (que al serializar a JSON queda como
//              timestamp con zona horaria, ej. "2016-06-21T04:00:00.000Z")
//   - BIGINT y NUMERIC -> string (para no perder precisión)
//
// La API tiene que devolver fechas ISO YYYY-MM-DD y números como números
// (ver shared/types.ts), así que los ajustamos acá, una sola vez.
// ----------------------------------------------------------------------------

types.setTypeParser(types.builtins.DATE, (valor) => valor) // 'YYYY-MM-DD' tal cual
types.setTypeParser(types.builtins.INT8, (valor) => parseInt(valor, 10))
types.setTypeParser(types.builtins.NUMERIC, (valor) => parseFloat(valor))

// Pool de conexiones pg. NO usar RDS Data API (ver claude_instructions.md).
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 5, // t3.micro: mantener el pool chico
})
