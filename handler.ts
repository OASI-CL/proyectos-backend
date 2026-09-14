import serverless from 'serverless-http'
import app from './src/app'

// Entry point Lambda (API Gateway)
export const handler = serverless(app)
