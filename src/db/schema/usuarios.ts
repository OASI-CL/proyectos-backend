import { sql } from 'drizzle-orm'
import { bigint, bigserial, check, pgTable, text } from 'drizzle-orm/pg-core'
import { auditoria } from './comun'
import { empresas } from './empresas'
import { organismos } from './organismos'
import { regiones } from './regiones'

/**
 * Quién puede entrar al sistema, con qué rol y con qué alcance.
 *
 * La cuenta vive en Cognito; esta tabla es la AUTORITATIVA para el rol y el
 * alcance, porque un rol sin su alcance no se puede aplicar. El grupo de
 * Cognito es solo una pista.
 *
 * Roles:
 *   admin      administra usuarios y su alcance
 *   oasi       ve todo y aprueba lo que mandan los demás
 *   organismo  ve los permisos de su organismo y los proyectos detrás;
 *              propone ediciones, que OASI aprueba
 *   empresa    ve solo sus proyectos/permisos, propone altas
 *   region     ve todos los proyectos de su región, de cualquier organismo
 *              (solo lectura)
 */
export const usuarios = pgTable(
  'usuarios',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** `sub` de Cognito: el identificador con el que llega el token. */
    cognito_sub: text('cognito_sub').notNull().unique(),
    nombre: text('nombre').notNull(),
    email: text('email').notNull(),
    rol: text('rol').notNull(),
    /** Alcance del rol 'empresa'. */
    empresa_id: bigint('empresa_id', { mode: 'number' }).references(() => empresas.id),
    /** Alcance del rol 'organismo'. */
    organismo_id: bigint('organismo_id', { mode: 'number' }).references(() => organismos.id),
    /** Alcance del rol 'region'. */
    region_id: bigint('region_id', { mode: 'number' }).references(() => regiones.id),
    ...auditoria,
  },
  (tabla) => [
    check('usuarios_rol_check', sql`${tabla.rol} IN ('admin', 'oasi', 'organismo', 'empresa', 'region')`),
    // Un rol acotado SIN su alcance vería todo. La base lo impide; el backend
    // además se niega a autenticarlo (middleware/auth.ts).
    check(
      'usuarios_scope_check',
      sql`(${tabla.rol} = 'empresa'   AND ${tabla.empresa_id}   IS NOT NULL) OR
          (${tabla.rol} = 'organismo' AND ${tabla.organismo_id} IS NOT NULL) OR
          (${tabla.rol} = 'region'    AND ${tabla.region_id}    IS NOT NULL) OR
          (${tabla.rol} IN ('admin', 'oasi'))`,
    ),
  ],
)

export type Usuario = typeof usuarios.$inferSelect
export type UsuarioNuevo = typeof usuarios.$inferInsert
