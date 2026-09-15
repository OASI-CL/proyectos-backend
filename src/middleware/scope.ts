import type { UsuarioAutenticado } from './auth'

/**
 * Scoping por rol. El backend SIEMPRE inyecta el filtro: nunca se confía en
 * que el frontend filtre.
 *
 *   empresa           -> solo los proyectos de su empresa
 *   organismo_lector  -> solo los permisos de su organismo
 *   oasi | admin      -> sin filtro
 *
 * Los helpers devuelven un fragmento SQL más sus parámetros, pensados para
 * concatenarse a un WHERE que se va armando con un contador de placeholders.
 */

export interface Condicion {
  sql: string
  params: unknown[]
}

/**
 * Pequeño constructor de WHERE. Lleva la cuenta de los $1, $2, ... para que
 * las queries siempre queden parametrizadas.
 */
export class WhereBuilder {
  private condiciones: string[] = []
  private valores: unknown[] = []

  add(sqlConPlaceholder: (n: number) => string, valor: unknown) {
    this.valores.push(valor)
    this.condiciones.push(sqlConPlaceholder(this.valores.length))
    return this
  }

  addRaw(sql: string) {
    this.condiciones.push(sql)
    return this
  }

  get where(): string {
    return this.condiciones.length ? `WHERE ${this.condiciones.join(' AND ')}` : ''
  }

  get params(): unknown[] {
    return this.valores
  }

  /** Siguiente número de placeholder disponible (para LIMIT/OFFSET). */
  push(valor: unknown): number {
    this.valores.push(valor)
    return this.valores.length
  }
}

/**
 * Aplica el scope del rol sobre una consulta a v_permisos (o v_permisos_comite,
 * que tiene las mismas columnas de scope).
 */
export function scopePermisos(wb: WhereBuilder, user: UsuarioAutenticado) {
  if (user.rol === 'empresa') {
    // empresaId null en un rol empresa = no puede ver nada (mejor eso que ver todo)
    wb.add((n) => `empresa_id = $${n}`, user.empresaId ?? -1)
  } else if (user.rol === 'organismo_lector') {
    wb.add((n) => `organismo_id = $${n}`, user.organismoId ?? -1)
  }
  return wb
}

/**
 * Aplica el scope del rol sobre una consulta a v_proyectos.
 *
 * Un organismo_lector ve solo los proyectos que tienen al menos un permiso en
 * su organismo (si no, vería el universo completo de proyectos).
 */
export function scopeProyectos(wb: WhereBuilder, user: UsuarioAutenticado) {
  if (user.rol === 'empresa') {
    wb.add((n) => `empresa_id = $${n}`, user.empresaId ?? -1)
  } else if (user.rol === 'organismo_lector') {
    wb.add(
      (n) => `id IN (SELECT proyecto_id FROM permisos WHERE organismo_id = $${n})`,
      user.organismoId ?? -1,
    )
  }
  return wb
}

/**
 * ¿Este usuario puede crear/editar proyectos y permisos?
 * Los roles de solo lectura (organismo_lector) nunca.
 */
export function puedeEscribir(user: UsuarioAutenticado): boolean {
  return user.rol === 'admin' || user.rol === 'oasi' || user.rol === 'empresa'
}
