import assert from 'node:assert/strict'
import {
  attendanceControls,
  createClientEventId,
  enqueueAttendanceEvent,
  nextAllowedAction,
  reduceAttendanceState,
  shouldRefreshSession,
  sortPendingEvents,
} from '../public/attendance-core.js'

assert.equal(createClientEventId(() => 'uuid-1'), 'att:uuid-1')

const first = {
  clientEventId: 'event-1',
  action: 'clock-in',
  clientOccurredAt: '2026-08-06T08:00:00.000Z',
  offlineCaptured: true,
}
const second = {
  clientEventId: 'event-2',
  action: 'clock-out',
  clientOccurredAt: '2026-08-06T17:00:00.000Z',
  offlineCaptured: true,
}

assert.deepEqual(enqueueAttendanceEvent([], first), [first])
assert.deepEqual(enqueueAttendanceEvent([first], { ...first }), [first])
assert.throws(
  () => enqueueAttendanceEvent([first], { ...first, action: 'clock-out' }),
  /CLIENT_EVENT_ID_CONFLICT/,
)
assert.deepEqual(sortPendingEvents([second, first]), [first, second])

const idle = { phase: 'idle', clockInAt: null, clockOutAt: null }
const working = reduceAttendanceState(idle, first)
assert.deepEqual(working, {
  phase: 'working',
  clockInAt: first.clientOccurredAt,
  clockOutAt: null,
  lastClientEventId: 'event-1',
})
assert.equal(nextAllowedAction(working), 'clock-out')

const completed = reduceAttendanceState(working, second)
assert.deepEqual(completed, {
  phase: 'completed',
  clockInAt: first.clientOccurredAt,
  clockOutAt: second.clientOccurredAt,
  lastClientEventId: 'event-2',
})
assert.equal(nextAllowedAction(completed), null)
assert.throws(() => reduceAttendanceState(working, first), /CLOCK_IN_ALREADY_OPEN/)
assert.throws(() => reduceAttendanceState(idle, second), /CLOCK_OUT_WITHOUT_CLOCK_IN/)

assert.deepEqual(attendanceControls(idle, { restored: false, syncing: false, submitting: false }), {
  clockInEnabled: false,
  clockOutEnabled: false,
})
assert.deepEqual(attendanceControls(idle, { restored: true, syncing: false, submitting: false }), {
  clockInEnabled: true,
  clockOutEnabled: false,
})
assert.deepEqual(attendanceControls(working, { restored: true, syncing: false, submitting: false }), {
  clockInEnabled: false,
  clockOutEnabled: true,
})
assert.deepEqual(attendanceControls(working, { restored: true, syncing: true, submitting: false }), {
  clockInEnabled: false,
  clockOutEnabled: false,
})

assert.equal(shouldRefreshSession(401), true)
assert.equal(shouldRefreshSession(403), false)

console.log('Attendance client tests passed · 18 assertions')
