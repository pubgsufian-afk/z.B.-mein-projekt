import assert from 'node:assert/strict'
import { createAttendanceService } from '../netlify/functions/_shared/attendance-service.mts'

function repositoryWithSite() {
  const events = []
  return {
    async listEvents() { return events },
    async findIdempotency() { return null },
    async findObject() { return { id: 'site-1', latitude: 52.375, longitude: 9.732, radiusMeters: 200 } },
    async commitClockEvent(record) {
      events.push(record.event)
      return { kind: 'created', response: { event: record.event, location: record.location, replayed: false } }
    },
    async listHistory() { return events },
    async listLive() { return events },
  }
}

const actor = { userId: 'employee-gps', email: 'gps@example.com', role: 'employee' }

const toleratedRepository = repositoryWithSite()
const toleratedService = createAttendanceService({ toleratedRepository, repository: toleratedRepository, now: () => new Date('2026-08-07T18:30:00.000Z'), randomUUID: () => 'gps-1' })
const latitudeOffsetFor390Meters = 390 / 111320
const accepted = await toleratedService.record(actor, {
  action: 'clock-in',
  clientEventId: 'gps-tolerated',
  clientOccurredAt: '2026-08-07T18:30:00.000Z',
  objectId: 'site-1',
  scheduleId: 'shift-1',
  location: { latitude: 52.375 + latitudeOffsetFor390Meters, longitude: 9.732, accuracyMeters: 220 },
})
assert.equal(accepted.event.locationStatus, 'inside')

const outsideRepository = repositoryWithSite()
const outsideService = createAttendanceService({ repository: outsideRepository, now: () => new Date('2026-08-07T18:30:00.000Z'), randomUUID: () => 'gps-2' })
const latitudeOffsetFor700Meters = 700 / 111320
await assert.rejects(() => outsideService.record(actor, {
  action: 'clock-in',
  clientEventId: 'gps-outside',
  clientOccurredAt: '2026-08-07T18:30:00.000Z',
  objectId: 'site-1',
  scheduleId: 'shift-1',
  location: { latitude: 52.375 + latitudeOffsetFor700Meters, longitude: 9.732, accuracyMeters: 40 },
}), (error) => {
  assert.equal(error?.code, 'OUTSIDE_WORKSITE')
  assert.match(error?.message || '', /Entfernung:/)
  assert.match(error?.message || '', /GPS-Genauigkeit:/)
  assert.match(error?.message || '', /Einsatzradius:/)
  return true
})

console.log('Location accuracy service contract tests passed')
