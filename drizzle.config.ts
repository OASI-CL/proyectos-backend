import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

/**
 * Configuración de drizzle-kit, la herramienta que GENERA las migraciones a
 * partir de los modelos de `src/db/schema/`.
 *
 *   npm run db:generate              compara los modelos con la última
 *                                    migración y escribe el SQL de la
 *                                    diferencia en db/migrations/
 *   npm run db:generate:custom       crea una migración vacía para escribir
 *                                    SQL a mano (vistas, triggers, datos de
 *                                    catálogos: cosas que un modelo no puede
 *                                    expresar)
 *
 * drizzle-kit solo ESCRIBE los archivos. Aplicarlos es siempre
 * `npm run db:migrate`, que usa nuestro propio runner (src/db/migrate.ts):
 * es el que sabe correr dentro de la Lambda, que es la única forma de llegar
 * a la base de AWS (no tiene salida a internet).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './db/migrations',
  // Solo lo usa `drizzle-kit` para comparar contra una base real si se lo pide
  // explícitamente; el flujo normal compara contra los snapshots de meta/.
  dbCredentials: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    database: process.env.DB_NAME ?? 'oasi_dev',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    ssl: false,
  },
  // No se configura `casing`: cada modelo declara explícitamente el nombre de
  // la columna en la base (snake_case) junto al nombre en el código
  // (camelCase), así que no hay conversión automática que pueda sorprender.
  verbose: true,
  strict: true,
})
