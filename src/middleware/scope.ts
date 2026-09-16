import type { UsuarioAutenticado } from './auth'

/**
 * Row-level scoping and the write/approval matrix.
 *
 * The backend ALWAYS injects the filter — the frontend is never trusted to
 * do it. Every query that returns project or permit rows must go through
 * scopePermisos / scopeProyectos.
 *
 * | role      | sees                                         | can write        |
 * |-----------|----------------------------------------------|------------------|
 * | admin     | everything                                   | direct           |
 * | oasi      | everything                                   | direct, approves |
 * | organismo | permits of its agency + those projects        | needs approval   |
 * | empresa   | its own projects + their permits              | needs approval   |
 * | region    | every project of its region, all agencies     | read-only        |
 */

export interface Condicion {
  sql: string
  params: unknown[]
}

/**
 * Small WHERE builder. Keeps track of $1, $2, ... so queries always stay
 * parameterised.
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

  /** Next available placeholder number (for LIMIT/OFFSET). */
  push(valor: unknown): number {
    this.valores.push(valor)
    return this.valores.length
  }
}

/**
 * Scopes a query against v_permisos (or v_permisos_comite, same columns).
 *
 * A scoped role whose scope is missing gets -1 / '' so it matches nothing —
 * failing closed is better than leaking the whole table.
 */
export function scopePermisos(wb: WhereBuilder, user: UsuarioAutenticado) {
  if (user.rol === 'empresa') {
    wb.add((n) => `empresa_id = $${n}`, user.empresaId ?? -1)
  } else if (user.rol === 'organismo') {
    wb.add((n) => `organismo_id = $${n}`, user.organismoId ?? -1)
  } else if (user.rol === 'region') {
    wb.add((n) => `region = $${n}`, user.region ?? '')
  }
  return wb
}

/**
 * Scopes a query against v_proyectos.
 *
 * An 'organismo' user only sees projects that have at least one permit in its
 * agency — otherwise it would see the whole project universe.
 */
export function scopeProyectos(wb: WhereBuilder, user: UsuarioAutenticado) {
  if (user.rol === 'empresa') {
    wb.add((n) => `empresa_id = $${n}`, user.empresaId ?? -1)
  } else if (user.rol === 'organismo') {
    wb.add(
      (n) => `id IN (SELECT proyecto_id FROM permisos WHERE organismo_id = $${n})`,
      user.organismoId ?? -1,
    )
  } else if (user.rol === 'region') {
    wb.add((n) => `region = $${n}`, user.region ?? '')
  }
  return wb
}

// ----------------------------------------------------------------------------
// Write matrix
// ----------------------------------------------------------------------------

/** Can this user submit changes at all (directly or for approval)? */
export function puedeEscribir(user: UsuarioAutenticado): boolean {
  return user.rol !== 'region'
}

/** Writes straight to the table, no approval step. */
export function escribeDirecto(user: UsuarioAutenticado): boolean {
  return user.rol === 'admin' || user.rol === 'oasi'
}

/**
 * Whether this user's edits have to be queued as a change request instead of
 * being applied: empresa and organismo propose, OASI approves.
 */
export function requiereAprobacion(user: UsuarioAutenticado): boolean {
  return user.rol === 'empresa' || user.rol === 'organismo'
}

/** Can review (approve/reject) other people's change requests. */
export function puedeAprobar(user: UsuarioAutenticado): boolean {
  return user.rol === 'admin' || user.rol === 'oasi'
}

/**
 * Can create whole projects. An 'organismo' can edit the permits it is
 * responsible for, but it does not own projects, so it cannot create them.
 */
export function puedeCrearProyectos(user: UsuarioAutenticado): boolean {
  return user.rol === 'admin' || user.rol === 'oasi' || user.rol === 'empresa'
}
