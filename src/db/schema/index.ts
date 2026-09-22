/**
 * El modelo de datos completo, en un solo lugar.
 *
 * Un archivo por tabla, con sus columnas, claves foráneas e índices. De acá
 * salen las migraciones (`npm run db:generate`) y los tipos de TypeScript.
 * Ver `comun.ts` para las reglas y para qué NO vive acá (vistas, triggers,
 * datos de los catálogos).
 */

// Catálogos: listas cerradas, con sus datos en una migración.
export * from './regiones'
export * from './sectores'
export * from './etapasProyecto'
export * from './estadosPermiso'
export * from './ministerios'
export * from './organismos'

// Entidades del negocio.
export * from './empresas'
export * from './proyectos'
export * from './permisos'
export * from './comites'
export * from './permisosComite'

// Acceso y auditoría.
export * from './usuarios'
export * from './solicitudesCambio'
export * from './historial'
export * from './adjuntos'

export { auditoria } from './comun'
