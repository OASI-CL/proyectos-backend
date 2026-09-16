import 'dotenv/config'
import { pool } from '../src/db/client'
import { runMigrations } from '../src/db/migrate'

// Local entry point for `npm run migrate`, against the database in .env.
// Deployed environments run the same runner through the db-ops Lambda.
runMigrations(pool)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
