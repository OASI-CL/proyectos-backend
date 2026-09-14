import { Pool } from 'pg'

// Pool de conexiones pg. NO usar RDS Data API (ver claude_instructions.md).
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 5, // t3.micro: mantener el pool chico
})
