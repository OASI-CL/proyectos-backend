// ============================================================================
// Tipos compartidos front/back — OASI
//
// Esta es la FUENTE DE VERDAD. Se copia a:
//   proyectos-frontend/src/shared/types.ts
//   proyectos-backend/src/shared/types.ts
// con `npm run sync-types` (ver scripts/sync-types.sh).
// NO editar las copias directamente, editar acá y correr el sync.
// ============================================================================

// --- Enums / literales -----------------------------------------------------

export type RolUsuario = 'admin' | 'oasi' | 'organismo_lector' | 'empresa'

export type EstadoPermiso = 'Pendiente' | 'Resuelto' | 'Descartado'

export type EstadoValidacion = 'borrador' | 'en_revision' | 'validado'

export type Semaforo = 'en_plazo' | 'en_alerta' | 'critico' | 'finalizado'

export type EntidadHistorial = 'proyecto' | 'permiso' | 'empresa'

// --- Auditoría (presente en toda tabla mutable) -----------------------------

export interface Auditoria {
  created_by: string | null
  updated_by: string | null
  created_at: string // ISO timestamp
  updated_at: string // ISO timestamp
}

// --- Entidades base ----------------------------------------------------------

export interface Empresa extends Auditoria {
  id: number
  id_excel: string | null
  nombre: string
  rut: string | null
}

export interface Organismo {
  id: number
  id_excel: string | null
  nombre: string
  ministerio_id: number
}

export interface Ministerio {
  id: number
  nombre: string
}

export interface Proyecto extends Auditoria {
  id: number
  id_excel: string | null
  nombre: string
  empresa_id: number
  sector: string
  region: string
  etapa: string
  inversion_mmusd: number | null
  estado_validacion: EstadoValidacion
}

export interface Permiso extends Auditoria {
  id: number
  id_excel: string | null
  proyecto_id: number
  organismo_id: number
  tipo_permiso: string
  nombre: string
  estado: EstadoPermiso
  fecha_ingreso: string | null // ISO date YYYY-MM-DD
  fecha_resolucion_estimada: string | null
  fecha_resolucion_real: string | null
  critico: boolean
  habilitante: boolean
  estado_validacion: EstadoValidacion
}

export interface Comite {
  id: number
  numero: number
  fecha: string // ISO date
}

export interface PermisoComite {
  id: number
  permiso_id: number
  comite_id: number
  estado_snapshot: EstadoPermiso | null
  dias_snapshot: number | null
  compromiso: string | null
}

export interface Usuario {
  id: number
  cognito_sub: string
  nombre: string
  email: string
  rol: RolUsuario
  empresa_id: number | null
  organismo_id: number | null
}

export interface HistorialItem {
  id: number
  entidad: EntidadHistorial
  entidad_id: number
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  usuario_sub: string
  usuario_nombre?: string // viene de v_historial (join con usuarios)
  created_at: string
}

export interface Adjunto {
  id: number
  permiso_id: number
  nombre_archivo: string
  s3_key: string
  content_type: string | null
  size_bytes: number | null
  uploaded_by: string
  created_at: string
}

// --- Vistas (valores calculados, nunca persistidos) -------------------------

export interface VPermiso extends Permiso {
  proyecto_nombre: string
  organismo_nombre: string
  ministerio_nombre: string
  empresa_nombre: string
  dias_tramitacion: number | null
  menos_3_meses: boolean
  entre_3_y_6_meses: boolean
  supera_6_meses: boolean
  semaforo: Semaforo
}

export interface VProyecto extends Proyecto {
  empresa_nombre: string
  total_permisos: number
  permisos_pendientes: number
  permisos_6meses: number
  criticos_pendientes: number
  sin_pendientes: boolean
}

export interface VPermisoComite extends VPermiso {
  comite_numero: number
  comite_fecha: string
}

export interface VResumenComite {
  comite_id: number
  comite_numero: number
  comite_fecha: string
  permisos_en_agenda: number
  permisos_resueltos: number
  promedio_dias: number | null
}

export interface VResumenOrganismo {
  organismo_id: number
  organismo_nombre: string
  pendientes: number
  supera_6_meses: number
  promedio_dias: number | null
  inversion_bloqueada_mmusd: number | null
}

// --- Filtros de API (query params) ------------------------------------------

export interface FiltrosPermisos {
  organismo_id?: number
  ministerio_id?: number
  estado?: EstadoPermiso
  tramo?: 'menos_3' | 'entre_3_6' | 'mas_6'
  region?: string
  sector?: string
  empresa_id?: number
  proyecto_id?: number
  critico?: boolean
  habilitante?: boolean
  fecha_ingreso_desde?: string
  fecha_ingreso_hasta?: string
  id_excel?: string
  q?: string // búsqueda de texto libre
}

export interface FiltrosProyectos {
  empresa_id?: number
  sector?: string
  region?: string
  etapa?: string
  con_permisos_6meses?: boolean
  sin_pendientes?: boolean
  id_excel?: string
  q?: string
}

// --- Envelope de respuesta paginada ------------------------------------------

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export interface ApiError {
  error: string
  message: string
}
