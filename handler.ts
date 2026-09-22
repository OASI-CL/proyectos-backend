import serverless from 'serverless-http'
import app from './src/app'

/**
 * Entry point de la Lambda (API Gateway HTTP API).
 *
 * `basePath` NO es opcional acá: el HTTP API usa un stage con nombre propio
 * (`dev` / `prod`), y eso hace que la ruta que llega a la Lambda incluya el
 * nombre del stage — `/dev/health` en vez de `/health`. Sin quitarlo, Express
 * no reconoce ninguna ruta y responde 404 a todo.
 *
 * (El REST API que se usaba antes sí lo quitaba solo, de ahí la diferencia.)
 *
 * API_STAGE lo setea el CDK (infra/lib/api-stack.ts). Sin esa variable, como
 * en desarrollo local, no se quita nada.
 */
const stage = process.env.API_STAGE

export const handler = serverless(app, stage ? { basePath: `/${stage}` } : {})
