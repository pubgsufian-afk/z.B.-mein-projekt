import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('netlify/functions/attendance-time-create.mts', 'utf8')

assert.match(source, /new Set\(\['owner', 'admin', 'manager'\]\)/)
assert.match(source, /pg_advisory_xact_lock/)
assert.match(source, /attendance_events/)
assert.match(source, /attendance_adjustments/)
assert.match(source, /attendance_audit_log/)
assert.match(source, /admin-time-create/)
assert.match(source, /Manueller Stundenzettel-Eintrag/)
assert.match(source, /überschneidet/i)
assert.match(source, /path: '\/api\/attendance-time-create'/)

console.log('timesheet create source contract passed')
