import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cors from 'cors'

import { requireAuth } from './middleware/auth'
import dashboardRouter from './routes/dashboard'
import proyectosRouter from './routes/proyectos'
import permisosRouter from './routes/permisos'
import comitesRouter from './routes/comites'
import organismosRouter from './routes/organismos'
import catalogosRouter from './routes/catalogos'
import adjuntosRouter from './routes/adjuntos'

const app = express()

// En producción hay que restringir el origen al dominio de Amplify,
// no dejarlo abierto (ver README).
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-dev-rol', 'x-dev-empresa-id', 'x-dev-organismo-id'],
}))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', authMode: process.env.AUTH_MODE ?? 'dev' })
})

// Devuelve quién soy, según el token (o el usuario falso en modo dev).
app.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})

// Todas las rutas de datos requieren autenticación.
app.use('/dashboard', requireAuth, dashboardRouter)
app.use('/proyectos', requireAuth, proyectosRouter)
app.use('/permisos', requireAuth, permisosRouter)
app.use('/comites', requireAuth, comitesRouter)
app.use('/organismos', requireAuth, organismosRouter)
app.use('/catalogos', requireAuth, catalogosRouter)
app.use('/adjuntos', requireAuth, adjuntosRouter)

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
