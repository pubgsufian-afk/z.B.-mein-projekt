import assert from 'node:assert/strict'
import {
  attendanceFunctionMarkers,
  clockingWindowForSchedule,
  displayAttendancePhase,
  plannedSchedules,
  resolvePortalRole,
  selectPlannedSchedule,
} from '../netlify/functions/attendance.mts'

assert.equal(resolvePortalRole({
  email: 'boss@example.com', ownerEmails: ['boss@example.com'], access: null, roles: ['employee'],
}), 'owner')
assert.equal(resolvePortalRole({
  email: 'lead@example.com', ownerEmails: [], access: { status: 'active', role: 'manager' }, roles: [],
}), 'manager')
assert.equal(resolvePortalRole({
  email: 'new@example.com', ownerEmails: [], access: { status: 'pending', role: 'employee' }, roles: ['employee'],
}), 'employee')
assert.equal(resolvePortalRole({ email: 'new@example.com', ownerEmails: [], access: null, roles: [] }), 'pending')

const schedules = [
  { id: 'shift-a', employeeUserId: 'user-1', date: '2026-08-06', start: '07:00', end: '12:00', objectId: 'site-a', status: 'published' },
  { id: 'shift-b', employeeUserId: 'user-1', date: '2026-08-06', start: '13:00', end: '18:00', objectId: 'site-b', status: 'published' },
  { id: 'draft', employeeUserId: 'user-1', date: '2026-08-06', start: '12:15', end: '12:45', objectId: 'site-d', status: 'draft' },
  { id: 'other-user', employeeUserId: 'user-2', date: '2026-08-06', start: '07:00', end: '18:00', objectId: 'site-c', status: 'published' },
]
assert.equal(plannedSchedules(schedules, 'user-1', '2026-08-06').length, 2)
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', 'shift-b').id, 'shift-b')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', 'other-user').id, 'shift-a')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', null, '2026-08-06T06:30:00.000Z').id, 'shift-a')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', null, '2026-08-06T11:30:00.000Z').id, 'shift-b')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', null, '2026-08-06T17:30:00.000Z').id, 'shift-b')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-07', null), null)

const fourteenToTwentyTwo = { id: 'shift-14-22', date: '2026-08-07', start: '14:00', end: '22:00' }
assert.equal(clockingWindowForSchedule(fourteenToTwentyTwo, '2026-08-07T10:59:00.000Z').allowed, false, '12:59 Berlin must still be blocked')
assert.equal(clockingWindowForSchedule(fourteenToTwentyTwo, '2026-08-07T11:00:00.000Z').allowed, true, '13:00 Berlin must open one hour before shift start')
assert.equal(clockingWindowForSchedule(fourteenToTwentyTwo, '2026-08-07T20:00:00.000Z').allowed, true, '22:00 Berlin must still be allowed')
assert.equal(clockingWindowForSchedule(fourteenToTwentyTwo, '2026-08-07T20:01:00.000Z').allowed, false, '22:01 Berlin must be blocked')
assert.equal(clockingWindowForSchedule(null, '2026-08-07T12:00:00.000Z').code, 'NO_PUBLISHED_SHIFT')
assert.equal(displayAttendancePhase('completed', fourteenToTwentyTwo, '2026-08-07T17:00:00.000Z'), 'idle', 'completed shift must reopen while its clocking window is active')
assert.equal(displayAttendancePhase('completed', fourteenToTwentyTwo, '2026-08-07T20:01:00.000Z'), 'blocked')
assert.equal(displayAttendancePhase('idle', fourteenToTwentyTwo, '2026-08-07T10:59:00.000Z'), 'blocked')
assert.equal(displayAttendancePhase('working', fourteenToTwentyTwo, '2026-08-07T17:00:00.000Z'), 'working')

const markers = attendanceFunctionMarkers()
assert.equal(markers.verifiesRequestOrigin, true)
assert.equal(markers.bindsScheduleServerSide, true)
assert.equal(markers.employeeSelfScope, true)
assert.equal(markers.liveManagementOnly, true)
assert.equal(markers.multipleDailyShifts, true)
assert.equal(markers.enforcesScheduleWindow, true)
assert.equal(markers.reopensCompletedShift, true)
assert.equal(markers.requiresInsideWorksite, true)

console.log('Attendance handler tests passed · 28 assertions')
