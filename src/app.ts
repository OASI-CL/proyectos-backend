import express from 'express'
import cors from 'cors'

// Rutas y middleware reales (auth, scope, routes/*) se agregan en la etapa
// de programación del backend. Este esqueleto solo deja el server andando
// para verificar que la instalación quedó correcta.

const app = express()

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// app.use('/proyectos', proyectosRouter)
// app.use('/permisos', permisosRouter)
// app.use('/comites', comitesRouter)
// app.use('/organismos', organismosRouter)
// app.use('/adjuntos', adjuntosRouter)
// app.use('/usuarios', usuariosRouter)

export default app
