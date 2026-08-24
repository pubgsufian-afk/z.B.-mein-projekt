import assert from 'node:assert/strict'
import fs from 'node:fs'

const endpoint = fs.readFileSync('netlify/functions/attendance-time-create.mts', 'utf8')
const service = fs.readFileSync('netlify/functions/_shared/attendance-admin-service.mts', 'utf8')

assert.match(endpoint, /new Set\(\['owner', 'admin', 'manager'\]\)/)
assert.match(endpoint, /verifyRequestOrigin/)
assert.match(endpoint, /attendance-admin-service\.mts/)
assert.match(endpoint, /attendanceAdminService\(\)\.createSession/)
assert.match(endpoint, /Manueller Stundenzettel-Eintrag/)
assert.match(endpoint, /path: '\/api\/attendance-time-create'/)
assert.doesNotMatch(endpoint, /pg_advisory_xact_lock|INSERT INTO attendance_events/)

for (const needle of [
  'pg_advisory_xact_lock',
  'attendance_events',
  'attendance_adjustments',
  'attendance_audit_log',
  'admin-time-create',
  "interval '24 months'",
  'überschneidet',
]) assert.ok(service.includes(needle), `missing shared create rule ${needle}`)

console.log('timesheet create source contract passed')
