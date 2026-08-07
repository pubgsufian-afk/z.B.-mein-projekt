import assert from 'node:assert/strict'
import { createAttendanceService } from '../netlify/functions/_shared/attendance-service.mts'

const events = []
const repository = {
  async listEvents() { return events },
  async findIdempotency() { return null },
  async findObject() {
    return { id: 'site-without-coordinates', latitude: null, longitude: null, radiusMeters: 2000 }
  },
  async commitClockEvent(record) {
    events.push(record.event)
    return { kind: 'created', response: { event: record.event, location: record.location, replayed: false } }
  },
  async listHistory() { return events },
  async listLive() { return events },
}

const service = createAttendanceService({
  repository,
  now: () => new Date('2026-08-07T18:56:00.000Z'),
  randomUUID: () => 'null-site-test',
})

const actor = { userId: 'employee-1', email: 'employee@example.com', role: 'employee' }

await assert.rejects(() => service.record(actor, {
  action: 'clock-in',
  clientEventId: 'null-site-client-event',
  clientOccurredAt: '2026-08-07T18:56:00.000Z',
  objectId: 'site-without-coordinates',
  scheduleId: 'shift-1',
  location: { latitude: 52.375, longitude: 9.732, accuracyMeters: 10 },
}), (error) => {
  assert.equal(error?.code, 'WORKSITE_NOT_CONFIGURED')
  assert.doesNotMatch(error?.message || '', /Entfernung:/)
  return true
})

console.log('Null worksite coordinate regression test passed')
