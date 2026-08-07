import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { attendancePhase, validateAttendanceTransition } from '../netlify/functions/_shared/attendance-domain.mjs'

const clockIn = [{ action: 'clock-in' }]
const paused = [...clockIn, { action: 'break-start' }]
const resumed = [...paused, { action: 'break-end' }]
const completed = [...resumed, { action: 'clock-out' }]

assert.equal(attendancePhase([]), 'idle')
assert.equal(attendancePhase(clockIn), 'working')
assert.equal(attendancePhase(paused), 'paused')
assert.equal(attendancePhase(resumed), 'working')
assert.equal(attendancePhase(completed), 'completed')
assert.equal(validateAttendanceTransition([], 'clock-in').ok, true)
assert.equal(validateAttendanceTransition(clockIn, 'break-start').ok, true)
assert.equal(validateAttendanceTransition(paused, 'break-end').ok, true)
assert.equal(validateAttendanceTransition(resumed, 'clock-out').ok, true)
assert.equal(validateAttendanceTransition(paused, 'clock-out').code, 'BREAK_MUST_END_FIRST')
assert.equal(validateAttendanceTransition([], 'break-start').code, 'BREAK_START_WITHOUT_WORK')
assert.equal(validateAttendanceTransition(clockIn, 'break-end').code, 'BREAK_END_WITHOUT_BREAK')

const [service, repository, migration] = await Promise.all([
  readFile('netlify/functions/_shared/attendance-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/neon-attendance.mts', 'utf8'),
  readFile('migrations/20260806_attendance_break_events.sql', 'utf8'),
])
assert.match(service, /break-start.*break-end/s)
assert.match(service, /locationAction/)
assert.match(service, /requiresInsideWorksite/)
assert.match(repository, /BREAK_MUST_END_FIRST/)
assert.match(migration, /'clock-in', 'break-start', 'break-end', 'clock-out'/)

console.log('Attendance pause tests passed')
