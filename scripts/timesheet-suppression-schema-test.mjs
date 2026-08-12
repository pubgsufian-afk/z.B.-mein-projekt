import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = 'netlify/database/migrations/20260812020000_add-timesheet-entry-suppression/migration.sql'
assert.equal(fs.existsSync(path), true, 'timesheet suppression migration missing')
const sql = fs.readFileSync(path, 'utf8')
assert.match(sql, /ADD COLUMN suppressed boolean NOT NULL DEFAULT false/i)
assert.match(sql, /ADD COLUMN suppressed_at timestamp with time zone/i)
assert.match(sql, /ADD COLUMN suppressed_by text/i)
console.log('timesheet suppression schema contract passed')
