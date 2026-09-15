// ============================================================================
// Tipos compartidos front/back — OASI
//
// Reflejan exactamente el schema de db/schema.sql y lo que devuelven las
// vistas. Frontend y backend son repos separados: este archivo está duplicado
// en los dos (proyectos-backend/src/shared/types.ts y
// proyectos-frontend/src/shared/types.ts). Si se edita, hay que actualizar
// las dos copias.
// ============================================================================

// --- Enums / literales -----------------------------------------------------

export type RolUsuario = 'admin' | 'oasi' | 'organismo_lector' | 'empresa'

export type EstadoPermiso = 'Pendiente' | 'Resuelto' | 'Descartado'

export type EstadoValidacion = 'borrador' | 'en_revision' | 'validado'

export type Semaforo = 'en_plazo' | 'en_alerta' | 'critico' | 'finalizado'

export type EntidadHistorial = 'proyecto' | 'permiso' | 'empresa'

export type TramoTramitacion = 'menos_3' | 'entre_3_6' | 'mas_6'

// --- Auditoría (presente en toda tabla mutable) -----------------------------

export interface Auditoria {
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

// --- Catálogos ---------------------------------------------------------------

export interface Ministerio {
  id: number
  nombre: string
}

export interface Organismo {
  id: number
  id_excel: string | null
  nombre: string
  ministerio_id: number
}

export interface Empresa extends Auditoria {
  id: number
  id_excel: string | null
  nombre: string
  rut: string | null
}

// --- Proyectos ----------------------------------------------------------------

export interface Proyecto extends Auditoria {
  id: number
  id_excel: string | null
  nombre: string
  titular: string | null
  empresa_id: number
  region: string | null
  sector: string | null
  inversion_mmusd: number | null
  empleo_construccion: number | null
  empleo_operacion: number | null
  estado_ambiental: string | null
  etapa: string | null
  fecha_inicio_construccion: string | null
  fecha_inicio_operacion: string | null
  habilitantes_aprobado: boolean | null
  fecha_ingreso: string | null
  fecha_ultima_resolucion: string | null
  observaciones_oasi: string | null
  estado_validacion: EstadoValidacion
}

// --- Permisos -----------------------------------------------------------------

export interface Permiso extends Auditoria {
  id: number
  id_excel: string | null
  proyecto_id: number
  organismo_id: number
  nombre: string
  nombre_estandar: string | null
  tipo_permiso: string | null
  n_expediente: string | null
  critico: boolean
  que_habilita: string | null
  habilitante_construccion: boolean
  estado: EstadoPermiso
  fecha_ingreso: string | null
  fecha_resolucion_estimada: string | null
  fecha_resolucion: string | null
  tipo_resolucion: string | null
  hito_tramitacion: string | null
  incluido_catastro_hacienda: boolean | null
  n_catastro: string | null
  observaciones: string | null
  estado_validacion: EstadoValidacion
}

// --- Comités -------------------------------------------------------------------

export interface Comite extends Auditoria {
  id: number
  numero: number
  fecha: string
}

export interface PermisoComite {
  id: number
  permiso_id: number
  comite_id: number
  estado_snapshot: EstadoPermiso | null
  dias_snapshot: number | null
  compromiso: string | null
}

// --- Usuarios ------------------------------------------------------------------

export interface Usuario extends Auditoria {
  id: number
  cognito_sub: string
  nombre: string
  email: string
  rol: RolUsuario
  empresa_id: number | null
  organismo_id: number | null
}

// --- Historial y adjuntos --------------------------------------------------------

export interface HistorialItem {
  id: number
  entidad: EntidadHistorial
  entidad_id: number
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  usuario_sub: string
  /** Viene de v_historial (join con usuarios). */
  usuario_nombre?: string | null
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

// ============================================================================
// Vistas — todos estos campos son calculados, no existen como columna.
// ============================================================================

/** v_permisos: calculado contra CURRENT_DATE. */
export interface VPermiso extends Permiso {
  proyecto_nombre: string
  proyecto_id_excel: string | null
  organismo_nombre: string
  ministerio_id: number
  ministerio_nombre: string
  empresa_id: number
  empresa_nombre: string
  /** Del proyecto: la página de Permisos filtra por estos campos. */
  region: string | null
  sector: string | null
  etapa: string | null
  inversion_mmusd: number | null
  dias_tramitacion: number | null
  menos_3_meses: boolean | null
  entre_3_y_6_meses: boolean | null
  supera_6_meses: boolean | null
  semaforo: Semaforo
}

/** v_proyectos: proyecto + conteos de sus permisos. */
export interface VProyecto extends Proyecto {
  empresa_nombre: string
  total_permisos: number
  permisos_pendientes: number
  permisos_6meses: number
  criticos_pendientes: number
  sin_pendientes: boolean
}

/** v_permisos_comite: lo mismo que v_permisos pero a la fecha del comité. */
export interface VPermisoComite extends VPermiso {
  comite_id: number
  comite_numero: number
  comite_fecha: string
  compromiso: string | null
  /** Estado reconstruido a la fecha de la sesión (o el snapshot guardado). */
  estado_a_la_fecha: EstadoPermiso
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
  ministerio_nombre?: string
  pendientes: number
  supera_6_meses: number
  promedio_dias: number | null
  inversion_bloqueada_mmusd: number | null
}

// --- Filtros de API (query params) ------------------------------------------

export interface FiltrosPermisos {
  organismo_id?: number
  ministerio_id?: number
  empresa_id?: number
  proyecto_id?: number
  estado?: EstadoPermiso
  tramo?: TramoTramitacion
  semaforo?: Semaforo
  region?: string
  sector?: string
  critico?: boolean
  habilitante?: boolean
  fecha_ingreso_desde?: string
  fecha_ingreso_hasta?: string
  id_excel?: string
  q?: string
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

// --- Envelopes de respuesta ---------------------------------------------------

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
