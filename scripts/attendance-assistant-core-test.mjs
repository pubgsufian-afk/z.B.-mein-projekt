import assert from 'node:assert/strict'
import { detectAttendanceDuplicates, validateAttendanceSessionEdit } from '../netlify/functions/_shared/attendance-assistant-core.mts'

const employees = [
  { userId: 'u1', fullName: 'Max Mustermann', status: 'active' },
  { userId: 'u2', fullName: '  MAX   MUSTERMANN ', status: 'inactive' },
  { userId: 'u3', fullName: 'Andere Person', status: 'active' },
]
const events = [
  { id: 'e1', userId: 'u1', action: 'clock-in', clientOccurredAt: '2026-08-10T06:00:00.000Z', eventDate: '2026-08-10', scheduleId: 's1' },
  { id: 'e2', userId: 'u1', action: 'clock-in', clientOccurredAt: '2026-08-10T06:00:00.000Z', eventDate: '2026-08-10', scheduleId: 'different-schedule' },
  { id: 'e3', userId: 'u3', action: 'clock-in', clientOccurredAt: '2026-08-10T06:00:00.000Z', eventDate: '2026-08-10', scheduleId: 's3' },
  { id: 'e4', userId: 'u1', action: 'clock-in', clientOccurredAt: '2026-08-11T06:00:00.000Z', eventDate: '2026-08-11', scheduleId: 's4' },
  { id: 'e5', userId: 'u1', action: 'clock-out', clientOccurredAt: '2026-08-11T14:00:00.000Z', eventDate: '2026-08-11', scheduleId: 's4' },
  { id: 'e6', userId: 'u2', action: 'clock-in', clientOccurredAt: '2026-08-11T06:00:00.000Z', eventDate: '2026-08-11', scheduleId: 's5' },
  { id: 'e7', userId: 'u2', action: 'clock-out', clientOccurredAt: '2026-08-11T14:00:00.000Z', eventDate: '2026-08-11', scheduleId: 's5' },
]
const diagnostics = detectAttendanceDuplicates(events, employees)
assert.equal(diagnostics.exactEvents.length, 1)
assert.deepEqual(diagnostics.exactEvents[0].eventIds, ['e1', 'e2'])
assert.equal(diagnostics.duplicateEmployeeNames.length, 1)
assert.deepEqual(diagnostics.duplicateEmployeeNames[0].userIds, ['u1', 'u2'])
assert.equal(diagnostics.duplicateSessions.length, 1)
assert.deepEqual(diagnostics.duplicateSessions[0].userIds, ['u1', 'u2'])

const valid = validateAttendanceSessionEdit({
  clockInAt: '2026-08-10T08:00:00.000Z',
  clockOutAt: '2026-08-10T16:00:00.000Z',
  pauseMinutes: 60,
})
assert.equal(valid.pauseMinutes, 60)
assert.throws(() => validateAttendanceSessionEdit({
  clockInAt: '2026-08-10T16:00:00.000Z',
  clockOutAt: '2026-08-10T08:00:00.000Z',
  pauseMinutes: 0,
}), /Arbeitsende/)
assert.throws(() => validateAttendanceSessionEdit({
  clockInAt: '2026-08-10T08:00:00.000Z',
  clockOutAt: '2026-08-10T09:00:00.000Z',
  pauseMinutes: 90,
}), /Pause/)
console.log('attendance assistant core tests passed')
