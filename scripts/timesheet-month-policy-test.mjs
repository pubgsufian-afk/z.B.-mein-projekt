import assert from 'node:assert/strict'
import { correctionDeadlineForMonth, isTimesheetScheduleSyncOpen, monthKeyForDate } from '../netlify/functions/_shared/timesheet-month-policy.mts'

assert.equal(correctionDeadlineForMonth('2026-08'), '2026-09-10')
assert.equal(isTimesheetScheduleSyncOpen('2026-08', new Date('2026-09-10T21:59:59Z')), true)
assert.equal(isTimesheetScheduleSyncOpen('2026-08', new Date('2026-09-10T22:00:00Z')), false)
assert.equal(correctionDeadlineForMonth('2026-12'), '2027-01-10')
assert.equal(monthKeyForDate('2026-08-31'), '2026-08')
assert.throws(() => monthKeyForDate('2026-02-30'), /Ungültiges Datum/)

console.log('timesheet month policy passed')
