import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  berlinDateTimeParts,
  buildFlexShiftRecord,
} from '../netlify/functions/_shared/attendance-auto-shift.mts'

const start = '2026-08-17T16:44:00.000Z'
const end = '2026-08-18T04:44:00.000Z'
const startParts = berlinDateTimeParts(start)
const endParts = berlinDateTimeParts(end)
assert.deepEqual(startParts, { date: '2026-08-17', time: '18:44' })
assert.deepEqual(endParts, { date: '2026-08-18', time: '06:44' })

const shift = buildFlexShiftRecord({
  scheduleId: 'attendance-flex:user-1:event-1',
  userId: 'user-1',
  fullName: 'Test Mitarbeiter',
  checkInAt: start,
  deadlineAt: end,
  worksite: { id: 'site-1', name: 'Objekt Nord' },
  sourceRef: 'event-1',
})
assert.equal(shift.employeeUserId, 'user-1')
assert.equal(shift.employeeName, 'Test Mitarbeiter')
assert.equal(shift.date, '2026-08-17')
assert.equal(shift.start, '18:44')
assert.equal(shift.end, '06:44')
assert.equal(shift.objectId, 'site-1')
assert.equal(shift.location, 'Objekt Nord')
assert.equal(shift.workArea, 'Zeiterfassung')
assert.equal(shift.status, 'published')
assert.equal(shift.source, 'attendance-flex')
assert.equal(shift.sourceRef, 'event-1')

const migration = await readFile('netlify/database/migrations/20260817193000_add-attendance-automation/migration.sql', 'utf8')
assert.match(migration, /attendance-flex/)
assert.match(migration, /schedule_shifts_time_check/)
assert.match(migration, /end_time <> start_time/)
assert.match(migration, /schedule_audit_actor_type_check/)
assert.match(migration, /'system'/)
assert.match(migration, /attendance_audit_log_actor_role_check/)

console.log('attendance auto shift contract: ok')
