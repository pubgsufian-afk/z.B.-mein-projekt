import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

globalThis.window = { addEventListener() {} }
const { reportPeriod } = await import('../public/reports-v2.js')
const { groupReportRows } = await import('../netlify/functions/reports-v2.mts')

assert.deepEqual(reportPeriod('day', '2026-08-06'), { from: '2026-08-06', to: '2026-08-06' })
assert.deepEqual(reportPeriod('month', '2026-02'), { from: '2026-02-01', to: '2026-02-28' })
assert.deepEqual(reportPeriod('month', '2028-02'), { from: '2028-02-01', to: '2028-02-29' })
assert.deepEqual(reportPeriod('range', '', '2026-08-01', '2026-08-31'), { from: '2026-08-01', to: '2026-08-31' })
assert.throws(() => reportPeriod('range', '', '2026-08-31', '2026-08-01'), /ungültig/)

const schedules = [
  { id: 's1', employeeUserId: 'u1', employeeName: 'Mitarbeiter A', date: '2026-08-06', start: '07:00', end: '12:00', pauseMinutes: 30, location: 'Werk A' },
  { id: 's2', employeeUserId: 'u1', employeeName: 'Mitarbeiter A', date: '2026-08-06', start: '13:00', end: '18:00', pauseMinutes: 30, location: 'Werk B' },
]
const events = [
  { user_id: 'u1', schedule_id: 's1', event_date: '2026-08-06', action: 'clock-in', client_occurred_at: '2026-08-06T05:00:00Z', location_status: 'inside', offline_captured: false },
  { user_id: 'u1', schedule_id: 's1', event_date: '2026-08-06', action: 'clock-out', client_occurred_at: '2026-08-06T10:00:00Z', location_status: 'inside', offline_captured: false },
  { user_id: 'u1', schedule_id: 's2', event_date: '2026-08-06', action: 'clock-in', client_occurred_at: '2026-08-06T11:00:00Z', location_status: 'outside', offline_captured: false },
  { user_id: 'u1', schedule_id: 's2', event_date: '2026-08-06', action: 'clock-out', client_occurred_at: '2026-08-06T16:00:00Z', location_status: 'inside', offline_captured: false },
]
const rows = groupReportRows(events, schedules)
assert.equal(rows.length, 2)
assert.deepEqual(rows.map((row) => row.scheduleId), ['s1', 's2'])
assert.deepEqual(rows.map((row) => row.netMinutes), [270, 270])
assert.equal(rows[1].warning, true)

const backend = await readFile(new URL('../netlify/functions/reports-v2.mts', import.meta.url), 'utf8')
assert.match(backend, /Mitarbeiter dürfen keine PDF-Berichte herunterladen/)
assert.match(backend, /plannedStart|plannedEnd/)
assert.match(backend, /pauseMinutes/)
assert.match(backend, /netMinutes/)
assert.match(backend, /Monats- und Gesamtsummen/)
assert.doesNotMatch(backend, /private address|Geburtsdatum|Steuer-ID|Personalnummer|Unterschrift/i)
assert.match(backend, /loadOriginalLogo/)
assert.match(backend, /drawCenteredPdfWatermark/)
assert.doesNotMatch(backend, /fetch\(new URL\(['"]\/habun-logo\.png['"]/)
assert.match(backend, /NO_DATA/)

console.log('Reports V2 tests passed · central PDF logo source covered')
