import assert from 'node:assert/strict'
import { displayAttendancePhase, clockingWindowForSchedule } from '../netlify/functions/attendance.mts'
import { createAttendanceService } from '../netlify/functions/_shared/attendance-service.mts'

const schedule = {
  id: 'shift-1',
  employeeUserId: 'employee-1',
  date: '2026-08-07',
  start: '14:00',
  end: '22:00',
  location: 'Baustelle',
  workArea: 'Brandwache',
  pauseMinutes: 0,
  objectId: 'site-1',
  status: 'published',
}
const afterEnd = new Date('2026-08-07T20:15:00.000Z') // 22:15 Europe/Berlin
assert.equal(clockingWindowForSchedule(schedule, afterEnd).allowed, false)
assert.equal(displayAttendancePhase('working', schedule, afterEnd), 'working')
assert.equal(displayAttendancePhase('paused', schedule, afterEnd), 'paused')

function repositoryWithSite() {
  const events = []
  return {
    async listEvents() { return events },
    async findIdempotency() { return null },
    async findObject() {
      return { id: 'site-1', latitude: 52.375, longitude: 9.732, radiusMeters: 100 }
    },
    async commitClockEvent(record) {
      events.push(record.event)
      return { kind: 'created', response: { event: record.event, location: record.location, replayed: false } }
    },
    async listHistory() { return events },
    async listLive() { return events },
  }
}

const actor = { userId: 'employee-1', email: 'employee@example.com', role: 'employee' }
const insideLocation = { latitude: 52.375, longitude: 9.732, accuracyMeters: 10 }
const outsideLocation = { latitude: 52.382, longitude: 9.732, accuracyMeters: 10 }

const strictRepo = repositoryWithSite()
const strictService = createAttendanceService({ repository: strictRepo, randomUUID: () => 'strict-1' })
await assert.rejects(() => strictService.record(actor, {
  action: 'clock-in',
  clientEventId: 'outside-start',
  clientOccurredAt: '2026-08-07T19:00:00.000Z',
  scheduleId: 'shift-1',
  objectId: 'site-1',
  location: outsideLocation,
}), (error) => {
  assert.equal(error?.code, 'OUTSIDE_WORKSITE')
  return true
})

const outsideEndRepo = repositoryWithSite()
const outsideEndService = createAttendanceService({ repository: outsideEndRepo, randomUUID: (() => {
  let counter = 0
  return () => `outside-end-${++counter}`
})() })
await outsideEndService.record(actor, {
  action: 'clock-in',
  clientEventId: 'outside-end-start',
  clientOccurredAt: '2026-08-07T19:00:00.000Z',
  scheduleId: 'shift-1',
  objectId: 'site-1',
  location: insideLocation,
})
const outsideEnd = await outsideEndService.record(actor, {
  action: 'clock-out',
  clientEventId: 'outside-end-finish',
  clientOccurredAt: '2026-08-07T20:15:00.000Z',
  scheduleId: 'shift-1',
  objectId: 'site-1',
  location: outsideLocation,
})
assert.equal(outsideEnd.event.locationStatus, 'outside')
assert.ok(Number(outsideEnd.location?.distanceMeters) > 100)

const noLocationRepo = repositoryWithSite()
const noLocationService = createAttendanceService({ repository: noLocationRepo, randomUUID: (() => {
  let counter = 0
  return () => `no-location-${++counter}`
})() })
await noLocationService.record(actor, {
  action: 'clock-in',
  clientEventId: 'no-location-start',
  clientOccurredAt: '2026-08-07T19:00:00.000Z',
  scheduleId: 'shift-1',
  objectId: 'site-1',
  location: insideLocation,
})
const noLocationEnd = await noLocationService.record(actor, {
  action: 'clock-out',
  clientEventId: 'no-location-finish',
  clientOccurredAt: '2026-08-07T20:16:00.000Z',
  scheduleId: 'shift-1',
  objectId: 'site-1',
  location: null,
})
assert.equal(noLocationEnd.event.locationStatus, 'unavailable')
assert.equal(noLocationEnd.location, null)

console.log('Attendance clock-out policy tests passed')
