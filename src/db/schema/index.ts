/**
 * El modelo de datos completo, en un solo lugar.
 *
 * Un archivo por tabla, con sus columnas, claves foráneas e índices. De acá
 * salen las migraciones (`npm run db:generate`) y los tipos de TypeScript.
 * Ver `comun.ts` para las reglas y para qué NO vive acá (vistas, triggers).
 *
 * Las tablas se dividen en tres grupos según DE DÓNDE salen sus datos:
 */

// 1. CATÁLOGOS — listas cerradas y estables. Sus datos están escritos a mano
//    en `db/seed_catalogos.py` (NO se leen del Excel). Solo cambian si cambia
//    el organigrama o la taxonomía: se edita ese archivo y se corre de nuevo.
export * from './ministerios'
export * from './organismos'
export * from './regiones'
export * from './sectores'
export * from './tipologias'
export * from './etapasProyecto'
export * from './estadosPermiso'

// 2. DATOS DEL EXCEL — crecen con cada planilla nueva. Los carga
//    `db/cargar_excel.py`, de forma incremental (actualiza lo que existe,
//    agrega lo nuevo, no borra nada).
export * from './empresas'
export * from './titulares'
export * from './proyectos'
export * from './permisos'
export * from './comites'
export * from './permisosComite'

// 3. PROPIOS DE LA APP — nunca vienen del Excel ni se tocan en una carga.
export * from './usuarios'
export * from './solicitudesCambio'
export * from './historial'
export * from './adjuntos'

export { auditoria } from './comun'
