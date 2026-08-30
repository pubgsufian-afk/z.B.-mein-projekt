import assert from 'node:assert/strict'
import { buildActualSessions, buildPlannedRows, plannedNetMinutes, summarizeTimesheetRows, sumMinutes, totalsByEmployee } from '../frontend/src/timesheet-utils.js'
import { mergeTimesheetRows } from '../frontend/src/timesheet-unified.js'

assert.equal(plannedNetMinutes('2026-08-08', '22:00', '06:00', 30), 450)
assert.equal(plannedNetMinutes('2026-08-08', '07:00', '17:00', 30), 570)

const sessions = buildActualSessions([
  { id: 'a1', userId: 'a', employeeName: 'A', action: 'clock-in', clientOccurredAt: '2026-08-08T06:00:00Z', eventDate: '2026-08-08', scheduleId: 'p1' },
  { id: 'b1', userId: 'b', employeeName: 'B', action: 'clock-in', clientOccurredAt: '2026-08-08T07:00:00Z', eventDate: '2026-08-08' },
  { id: 'a2', userId: 'a', action: 'clock-out', clientOccurredAt: '2026-08-08T14:00:00Z', eventDate: '2026-08-08', scheduleId: 'p1', pauseMinutesAdjustment: 30 },
  { id: 'b2', userId: 'b', action: 'clock-out', clientOccurredAt: '2026-08-08T17:00:00Z', eventDate: '2026-08-08', pauseMinutesAdjustment: 45 },
])
assert.equal(sessions.length, 2)
assert.equal(sessions.find((row) => row.userId === 'a').netMinutes, 450)
assert.equal(sessions.find((row) => row.userId === 'b').netMinutes, 555)

const gpsLocationSession = buildActualSessions([
  {
    id: 'gps-in', userId: 'gps-user', employeeName: 'GPS Mitarbeiter', action: 'clock-in',
    clientOccurredAt: '2026-08-08T06:00:00Z', eventDate: '2026-08-08', objectId: 'objekt-123',
    location: { latitude: 52.3, longitude: 9.7, accuracyMeters: 12 },
  },
  { id: 'gps-out', userId: 'gps-user', action: 'clock-out', clientOccurredAt: '2026-08-08T14:00:00Z', eventDate: '2026-08-08' },
])[0]
assert.equal(gpsLocationSession.location, 'objekt-123')
assert.equal(typeof gpsLocationSession.location, 'string')

const planned = buildPlannedRows([
  { id: 'p1', employeeUserId: 'a', employeeName: 'A', date: '2026-08-08', start: '22:00', end: '06:00', pauseMinutes: 30, location: 'Objekt 1', workArea: 'Brandwache', objectId: 'obj-1' },
  { id: 'p2', employeeUserId: 'b', employeeName: 'B', date: '2026-08-08', start: '07:00', end: '17:00', pauseMinutes: 30, location: 'Objekt 2', workArea: 'ZuKo', objectId: 'obj-2' },
])
assert.equal(planned[0].netMinutes, 450)
assert.equal(planned[1].netMinutes, 570)
assert.equal(planned[0].objectId, 'obj-1')
assert.equal(sumMinutes(planned), 1020)
assert.deepEqual(totalsByEmployee(planned), [
  { employeeName: 'A', minutes: 450 },
  { employeeName: 'B', minutes: 570 },
])

const summaries = summarizeTimesheetRows([
  { userId: 'a', employeeName: 'A', date: '2026-08-08', netMinutes: 450, pauseMinutes: 30, source: 'planned' },
  { userId: 'a', employeeName: 'A', date: '2026-08-08', netMinutes: 120, breakMinutes: 0, source: 'actual' },
  { userId: 'b', employeeName: 'B', date: '2026-08-09', netMinutes: 570, pauseMinutes: 30, source: 'planned' },
])
assert.deepEqual(summaries.employees, [
  { userId: 'a', employeeName: 'A', workDays: 1, shifts: 2, pauseMinutes: 30, minutes: 570 },
  { userId: 'b', employeeName: 'B', workDays: 1, shifts: 1, pauseMinutes: 30, minutes: 570 },
])
assert.deepEqual(summaries.total, { employees: 2, workDays: 2, shifts: 3, pauseMinutes: 60, minutes: 1140 })

const sameNameDifferentIds = summarizeTimesheetRows([
  { employeeUserId: 'person-1', employeeName: 'Gleicher Name', workDate: '2026-08-10', netMinutes: 60, pauseMinutes: 0 },
  { employeeUserId: 'person-2', employeeName: 'Gleicher Name', workDate: '2026-08-10', netMinutes: 120, pauseMinutes: 0 },
])
assert.equal(sameNameDifferentIds.employees.length, 2)
assert.deepEqual(sameNameDifferentIds.employees.map((item) => item.userId), ['person-1', 'person-2'])

const unified = mergeTimesheetRows([sessions.find((row) => row.userId === 'a')], planned)
assert.equal(unified.length, 2)
assert.equal(unified.find((row) => row.userId === 'a').source, 'actual')
assert.equal(unified.find((row) => row.userId === 'a').scheduleId, 'p1')
assert.equal(unified.find((row) => row.userId === 'a').workArea, 'Brandwache')
assert.equal(unified.find((row) => row.userId === 'b').source, 'planned')

const readableLocation = mergeTimesheetRows([{
  userId: 'a', employeeName: 'A', date: '2026-08-08', scheduleId: 'p1', objectId: 'obj-1',
  clockInAt: '2026-08-08T20:00:00Z', clockOutAt: '2026-08-09T04:00:00Z',
  location: 'obj-1', breakMinutes: 30, netMinutes: 450,
}], planned)
assert.equal(readableLocation.find((row) => row.userId === 'a').location, 'Objekt 1')

const nearest = mergeTimesheetRows([
  {
    userId: 'late', employeeName: 'Late', date: '2026-08-08',
    clockInAt: '2026-08-08T05:05:00Z', clockOutAt: '2026-08-08T15:00:00Z',
    breakMinutes: 30, netMinutes: 565, scheduleId: null, location: '–',
  },
], buildPlannedRows([
  { id: 'early', employeeUserId: 'late', employeeName: 'Late', date: '2026-08-08', start: '07:00', end: '17:00', pauseMinutes: 30, location: 'Objekt A', workArea: 'ZuKo' },
  { id: 'late-shift', employeeUserId: 'late', employeeName: 'Late', date: '2026-08-08', start: '18:00', end: '22:00', pauseMinutes: 0, location: 'Objekt B', workArea: 'Brandwache' },
]))
assert.equal(nearest.length, 2)
assert.equal(nearest.find((row) => row.source === 'actual').scheduleId, 'early')
assert.equal(nearest.find((row) => row.source === 'actual').workArea, 'ZuKo')
assert.equal(nearest.find((row) => row.source === 'planned').scheduleId, 'late-shift')

console.log('timesheet utils tests passed')
