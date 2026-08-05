import assert from 'node:assert/strict'
import {
  attendanceFunctionMarkers,
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
  { id: 'shift-a', employeeUserId: 'user-1', date: '2026-08-06', start: '07:00', end: '12:00', objectId: 'site-a' },
  { id: 'shift-b', employeeUserId: 'user-1', date: '2026-08-06', start: '13:00', end: '18:00', objectId: 'site-b' },
  { id: 'other-user', employeeUserId: 'user-2', date: '2026-08-06', start: '07:00', end: '18:00', objectId: 'site-c' },
]
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', 'shift-b').id, 'shift-b')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-06', 'other-user').id, 'shift-a')
assert.equal(selectPlannedSchedule(schedules, 'user-1', '2026-08-07', null), null)

const markers = attendanceFunctionMarkers()
assert.equal(markers.verifiesRequestOrigin, true)
assert.equal(markers.bindsScheduleServerSide, true)
assert.equal(markers.employeeSelfScope, true)
assert.equal(markers.liveManagementOnly, true)

console.log('Attendance handler tests passed · 11 assertions')
