// ============================================================================
// Tipos compartidos front/back — OASI
//
// Reflejan exactamente el modelo de src/db/schema/ y lo que devuelven las
// vistas. Frontend y backend son repos separados: este archivo está duplicado
// en los dos (proyectos-backend/src/shared/types.ts y
// proyectos-frontend/src/shared/types.ts). Si se edita, hay que actualizar
// las dos copias.
// ============================================================================

// --- Enums / literales -----------------------------------------------------

/**
 * admin      — manages users and their scope
 * oasi       — sees everything, approves what the other roles submit
 * organismo  — sees the permits of its own agency and the projects behind
 *              them; can propose permit edits (OASI approves them)
 * empresa    — sees only its own projects/permits, can propose new ones
 * region     — sees every project of its region, across all agencies (read-only)
 */
export type RolUsuario = 'admin' | 'oasi' | 'organismo' | 'empresa' | 'region'

/**
 * Display name of a permit state, as every view exposes it under `estado`.
 *
 * DECISION: `estado` is now a FK (`permisos.estado_id` -> `estados_permiso`),
 * but this type stays a union of the NAMES rather than becoming a number.
 * Reason: everything that reads a permit reads it through a view, and the
 * views resolve the catalog, so `estado` is still a string everywhere in the
 * UI and in the filter query params. Ids appear only where a row is written
 * (`estado_id`) or where the catalog itself is listed, and they are typed as
 * plain `number` there. Keeping the union means the badge components, the CSV
 * export and the filter bar did not have to change at all.
 *
 * `EstadoPermisoCodigo` is the stable machine-readable key (`estado_codigo`
 * on the views) — prefer it over the display name in new code.
 */
export type EstadoPermiso = 'Pendiente' | 'Resuelto' | 'Descartado' | 'Desistido'

export type EstadoPermisoCodigo = 'pendiente' | 'resuelto' | 'descartado' | 'desistido'

export type EtapaProyectoCodigo = 'no_iniciado' | 'construccion' | 'operacion'

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
  /** 'MOP', 'MINVU', ... NULL for 'Municipalidades'. */
  sigla: string | null
}

export interface Organismo {
  id: number
  /** Sigla as it comes from the source Excel. Display only, never a FK. */
  id_excel: string | null
  /** Sigla it is known by, e.g. 'CONAF'. */
  nombre: string
  /** Full name, for formal reports. */
  nombre_largo: string | null
  ministerio_id: number
}

export interface Empresa extends Auditoria {
  id: number
  /** 'E100', etc. NULL when the company was created from the app. */
  id_excel: string | null
  nombre: string
  /** Legal name, when it differs from `nombre`. */
  razon_social: string | null
  rut: string | null
  email_contacto: string | null
  telefono_contacto: string | null
  /** false = not offered when creating new projects. */
  activa: boolean
}

/**
 * Chilean region.
 *
 * `id` is the geographic order north -> south (that is the display order);
 * `numero` is the official region number. Ids 90 ('Interregional') and 91
 * ('Nivel Central') are not real regions but come that way in the source
 * Excel — projects spanning several regions, or handled centrally — and
 * carry NULL in `numero` / `codigo`.
 */
export interface Region {
  id: number
  numero: number | null
  /** Roman numeral it is usually called by ('II', 'RM', ...). */
  codigo: string | null
  nombre: string
  nombre_oficial: string | null
}

export interface Sector {
  id: number
  nombre: string
  /** Presentation order in dropdowns and charts. */
  orden: number
}

/** Subclasificación dentro de un sector (catálogo `tipologias`, 71 filas). */
export interface Tipologia {
  id: number
  sector_id: number
  nombre: string
}

export interface EtapaProyecto {
  id: number
  codigo: EtapaProyectoCodigo
  nombre: string
  /** Real project progress, for sorting. */
  orden: number
}

/**
 * Row of the `estados_permiso` catalog. Named with the `Catalogo` suffix
 * because `EstadoPermiso` above is the display-name union (see its comment).
 */
export interface EstadoPermisoCatalogo {
  id: number
  codigo: EstadoPermisoCodigo
  nombre: EstadoPermiso
  /** true for the states that close the process ('Resuelto', 'Descartado'). */
  es_final: boolean
  orden: number
}

// --- Proyectos ----------------------------------------------------------------

export interface Proyecto extends Auditoria {
  id: number
  id_excel: string | null
  nombre: string
  titular: string | null
  empresa_id: number
  region_id: number | null
  sector_id: number | null
  /** Subclasificación dentro del sector (catálogo `tipologias`). Sin usar aún: 0/326 proyectos la traen. */
  tipologia_id: number | null
  etapa_id: number | null
  inversion_mmusd: number | null
  empleo_construccion: number | null
  empleo_operacion: number | null
  estado_ambiental: string | null
  fecha_inicio_construccion: string | null
  fecha_inicio_operacion: string | null
  habilitantes_aprobado: boolean | null
  fecha_ingreso: string | null
  fecha_ultima_resolucion: string | null
  observaciones_oasi: string | null
  estado_validacion: EstadoValidacion
  /** 1 o 2 en el Excel origen. Significado exacto sin confirmar con OASI. */
  n_catastro: number | null
  /** Catastro de Hacienda a nivel proyecto (distinto de `Permiso.incluido_catastro_hacienda`, que es por permiso). */
  incluido_en_catastro: boolean | null
  /** Si el proyecto está dentro del universo de seguimiento activo de OASI. */
  en_universo_permisos: boolean | null
  sigue_liberado_al_contactar: boolean | null
  listado_37_proyectos_liberados: boolean | null
  listado_97_proyectos_no_iniciados: boolean | null
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
  estado_id: number
  fecha_ingreso: string | null
  fecha_resolucion_estimada: string | null
  fecha_resolucion: string | null
  tipo_resolucion: string | null
  hito_tramitacion: string | null
  incluido_catastro_hacienda: boolean | null
  n_catastro: string | null
  observaciones: string | null
  estado_validacion: EstadoValidacion
  /** Si el permiso está dentro del universo de seguimiento activo de OASI. */
  en_universo: boolean | null
  fecha_registro_catastro: string | null
  /**
   * Cuándo y quién lo actualizó por última vez EN LA PLANILLA origen (no es
   * `updated_at`/`updated_by`, que pone el trigger cuando se edita desde la app).
   */
  fecha_actualizacion: string | null
  quien_actualizo: string | null
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
  estado_snapshot_id: number | null
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
  /** Scope of the 'region' role. FK to regiones. */
  region_id: number | null
}

/** v_usuarios: the user with its scope resolved to readable names. */
export interface VUsuario extends Usuario {
  empresa_nombre: string | null
  organismo_nombre: string | null
  region: string | null
}

// --- Approval workflow --------------------------------------------------------

export type EntidadSolicitud = 'proyecto' | 'permiso'
export type TipoSolicitud = 'creacion' | 'edicion'
export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada'

export interface SolicitudCambio {
  id: number
  entidad: EntidadSolicitud
  entidad_id: number
  tipo: TipoSolicitud
  cambios: Record<string, unknown>
  estado: EstadoSolicitud
  comentario: string | null
  solicitado_por: string
  solicitado_at: string
  revisado_por: string | null
  revisado_at: string | null
  comentario_revision: string | null
}

/** v_solicitudes_cambio: the request plus the context the reviewer needs. */
export interface VSolicitudCambio extends SolicitudCambio {
  solicitado_por_nombre: string | null
  revisado_por_nombre: string | null
  entidad_nombre: string | null
  entidad_id_excel: string | null
  empresa_id: number | null
  empresa_nombre: string | null
  organismo_id: number | null
  organismo_nombre: string | null
  region_id: number | null
  region: string | null
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
  /** Catálogo estados_permiso resuelto. */
  estado: EstadoPermiso
  estado_codigo: EstadoPermisoCodigo
  /** true en 'Resuelto'/'Descartado': la tramitación terminó. */
  estado_es_final: boolean
  proyecto_nombre: string
  proyecto_id_excel: string | null
  organismo_nombre: string
  ministerio_id: number
  ministerio_nombre: string
  empresa_id: number
  empresa_nombre: string
  /** Del proyecto: la página de Permisos filtra por estos campos. */
  region_id: number | null
  region: string | null
  sector_id: number | null
  sector: string | null
  etapa_id: number | null
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
  /** Catálogos resueltos a nombre legible. */
  region: string | null
  region_numero: number | null
  region_codigo: string | null
  sector: string | null
  etapa: string | null
  etapa_codigo: EtapaProyectoCodigo | null
  total_permisos: number
  permisos_pendientes: number
  permisos_6meses: number
  criticos_pendientes: number
  sin_pendientes: boolean
}

/**
 * v_permisos_comite: la tabla de un comité es ACUMULATIVA Y ESTRICTA — los
 * permisos que entraron en comités con número MENOR a `comite_numero`, no
 * los vinculados a esa sesión. No trae `semaforo` ni `estado_es_final` (son
 * relativos a CURRENT_DATE, acá todo es a la fecha de la sesión).
 */
export interface VPermisoComite extends Omit<VPermiso, 'semaforo' | 'estado_es_final'> {
  /** La sesión que se está mirando. */
  comite_id: number
  comite_numero: number
  comite_fecha: string
  /** La sesión en la que el permiso entró (siempre menor que comite_numero). */
  comite_ingreso_numero: number
  compromiso: string | null
  /** Estado que tenía el permiso el día de esa sesión. */
  estado_a_la_fecha: EstadoPermiso
  /** true si ese día ya estaba resuelto/descartado/desistido. */
  finalizado_a_la_fecha: boolean
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
  /** Por nombre (lo que manda la UI) o por id de catálogo, indistinto. */
  region?: string
  region_id?: number
  sector?: string
  sector_id?: number
  estado_id?: number
  critico?: boolean
  habilitante?: boolean
  fecha_ingreso_desde?: string
  fecha_ingreso_hasta?: string
  id_excel?: string
  q?: string
}

export interface FiltrosProyectos {
  empresa_id?: number
  /** Por nombre (lo que manda la UI) o por id de catálogo, indistinto. */
  sector?: string
  sector_id?: number
  region?: string
  region_id?: number
  etapa?: string
  etapa_id?: number
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
