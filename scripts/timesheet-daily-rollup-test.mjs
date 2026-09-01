import assert from 'node:assert/strict'
import { pauseDisplay, rollupDailyTimesheetRows } from '../shared/timesheet-daily-rollup.mjs'

const rows = rollupDailyTimesheetRows([
  {
    id: 'first', employeeUserId: 'person-1', employeeName: 'Mitarbeiter A', workDate: '2026-08-10',
    start: '10:00', end: '17:00', pauseMinutes: 30, netMinutes: 390, location: 'Ort A', workArea: 'GMP',
  },
  {
    id: 'second', employeeUserId: 'person-1', employeeName: 'Mitarbeiter A', workDate: '2026-08-10',
    start: '18:00', end: '22:00', pauseMinutes: 30, netMinutes: 210, location: 'Ort B', workArea: 'Brandwache',
  },
  {
    id: 'overnight', employeeUserId: 'person-1', employeeName: 'Mitarbeiter A', workDate: '2026-08-11',
    start: '22:00', end: '06:00', pauseMinutes: 0, netMinutes: 480,
  },
  {
    id: 'same-name', employeeUserId: 'person-2', employeeName: 'Mitarbeiter A', workDate: '2026-08-10',
    start: '07:00', end: '09:00', pauseMinutes: 0, netMinutes: 120,
  },
])

assert.equal(rows.length, 3, 'one row per exact employee identity and date')
const combined = rows.find((row) => row.employeeUserId === 'person-1' && row.workDate === '2026-08-10')
assert.ok(combined)
assert.equal(combined.start, '10:00')
assert.equal(combined.end, '22:00')
assert.equal(combined.pauseMinutes, 60)
assert.equal(combined.netMinutes, 600, 'net time sums shifts and excludes the 17:00-18:00 gap')
assert.equal(combined.entryCount, 2)
assert.deepEqual(combined.entries.map((row) => row.id), ['first', 'second'])

const overnight = rows.find((row) => row.workDate === '2026-08-11')
assert.equal(overnight.start, '22:00')
assert.equal(overnight.end, '06:00')
assert.equal(overnight.netMinutes, 480)
assert.equal(pauseDisplay(0), '–')
assert.equal(pauseDisplay(60), '60 Min.')

console.log('daily timesheet rollup tests passed')
