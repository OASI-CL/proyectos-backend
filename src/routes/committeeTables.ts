import { Router } from 'express'
import { pool } from '../db/client'
import { requireRol } from '../middleware/auth'
import { fetchCommitteeTables } from '../models/committeeTables'

const router = Router()

/**
 * GET /committee-tables — the tables of the Excel "Tablas PPT" sheet (the
 * ones that go into the committee presentation). They are global figures
 * for the whole catastro, so only the OASI team sees them (same as Comités).
 */
router.get('/', requireRol('admin', 'oasi'), async (_req, res, next) => {
  try {
    const tables = await fetchCommitteeTables(pool)
    if (!tables) {
      return res.status(404).json({ error: 'no_sessions', message: 'Todavía no hay sesiones del comité realizadas.' })
    }
    res.json(tables)
  } catch (err) {
    next(err)
  }
})

export default router
