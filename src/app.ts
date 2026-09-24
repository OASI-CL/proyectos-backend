import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cors from 'cors'

import { pool } from './db/client'
import { requireAuth, identificar } from './middleware/auth'
import dashboardRouter from './routes/dashboard'
import proyectosRouter from './routes/proyectos'
import permisosRouter from './routes/permisos'
import comitesRouter from './routes/comites'
import organismosRouter from './routes/organismos'
import catalogosRouter from './routes/catalogos'
import catalogRouter from './routes/catalog'
import adjuntosRouter from './routes/adjuntos'
import approvalsRouter from './routes/approvals'
import usuariosRouter from './routes/usuarios'

const app = express()

// CORS_ORIGIN is a comma-separated list of browser origins allowed to call the
// API (on AWS it comes from infra/lib/config.ts). Left empty, local
// development accepts any origin, but a deployed API accepts none: an unset
// value must never silently mean "open".
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const isDeployed = process.env.NODE_ENV === 'production'

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : !isDeployed,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    // Dev-mode role simulation headers. The backend ignores them when
    // AUTH_MODE=cognito, but they still have to be allowed through CORS or
    // the browser blocks the request before it ever reaches the API.
    'x-dev-rol',
    'x-dev-empresa-id',
    'x-dev-organismo-id',
    'x-dev-region',
  ],
}))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', authMode: process.env.AUTH_MODE ?? 'dev' })
})

// Proves the whole path works — Lambda to Secrets Manager to Postgres — not
// just that Express started. CI calls it right after every deploy.
app.get('/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'reachable' })
  } catch (err) {
    console.error('[health/db]', err)
    res.status(503).json({ status: 'error', database: 'unreachable' })
  }
})

// Devuelve quién soy, según el token (o el usuario falso en modo dev).
// Usa `identificar`, no `requireAuth`: si el token es válido pero a la
// persona le falta rol o alcance, `identificar` ya responde 200 con lo que
// se sabe (nombre, email, el mensaje de qué falta) sin llegar hasta acá —
// así el frontend puede mostrar el botón "Salir" en vez de dejarla sin
// ninguna salida. Acá solo se llega cuando el usuario quedó resuelto del todo.
app.get('/me', identificar, (req, res) => {
  res.json(req.user)
})

// Todas las rutas de datos requieren autenticación.
app.use('/dashboard', requireAuth, dashboardRouter)
app.use('/proyectos', requireAuth, proyectosRouter)
app.use('/permisos', requireAuth, permisosRouter)
app.use('/comites', requireAuth, comitesRouter)
app.use('/organismos', requireAuth, organismosRouter)
// /catalogos (Spanish) still serves the older pages; /catalog is the English
// replacement used by the dashboard. The old one goes away as those pages
// get migrated.
app.use('/catalogos', requireAuth, catalogosRouter)
app.use('/catalog', requireAuth, catalogRouter)
app.use('/adjuntos', requireAuth, adjuntosRouter)
app.use('/approvals', requireAuth, approvalsRouter)
app.use('/usuarios', requireAuth, usuariosRouter)

// 404 para rutas no conocidas
app.use((_req, res) => {
  res.status(404).json({ error: 'no_encontrado', message: 'Ruta no encontrada' })
})

// Manejador de errores: loguea el detalle pero no lo expone al cliente.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err)
  res.status(500).json({ error: 'error_interno', message: 'Ocurrió un error en el servidor' })
})

export default app
