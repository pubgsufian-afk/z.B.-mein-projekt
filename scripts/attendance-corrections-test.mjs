import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const backend = await readFile(new URL('../netlify/functions/attendance-maintenance.mts', import.meta.url), 'utf8')
const client = await readFile(new URL('../public/attendance-corrections.js', import.meta.url), 'utf8')

assert.match(backend, /WHERE id = \$1 AND user_id = \$2/)
assert.match(backend, /cleanRequestedData/)
assert.match(backend, /clockInAt.*clockOutAt.*pauseMinutes.*note/s)
assert.doesNotMatch(backend.match(/function cleanRequestedData[\s\S]*?\n}/)?.[0] || '', /latitude|longitude|locationStatus/)
assert.match(backend, /approved.*rejected.*clarification/)
assert.match(backend, /attendance_correction_decisions/)
assert.match(backend, /attendance_audit_log/)
assert.match(client, /Standortdaten können nicht verändert werden/)
assert.match(client, /Die ursprüngliche Buchung bleibt unverändert erhalten/)
assert.match(backend, /await sql\.query\(/, 'Attendance maintenance must use the Neon v1 query API')
assert.doesNotMatch(backend, /await sql\(/, 'Legacy Neon sql(query, params) calls must not remain')

console.log('Attendance correction tests passed · 11 assertions')
