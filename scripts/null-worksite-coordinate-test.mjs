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

// Production regression: current registry coordinates must take precedence over a stale SQL copy.
const { coordinate, validWorksiteCoordinates, resolveAttendanceWorksite } = await import('../netlify/functions/_shared/attendance-worksite-policy.mts')
assert.equal(coordinate(null, -90, 90), null)
assert.equal(coordinate('  ', -90, 90), null)
assert.equal(coordinate(false, -90, 90), null)
assert.equal(validWorksiteCoordinates({ latitude: 0, longitude: 0 }), false)
assert.equal(validWorksiteCoordinates({ latitude: 91, longitude: 9 }), false)
assert.equal(validWorksiteCoordinates({ latitude: 52.4, longitude: 9.5 }), true)
const current = { id: 'site-1', latitude: 52.4, longitude: 9.5, radiusMeters: 100 }
let inserted = []
const lookup = (registered, database) => ({
  readRegistered: async () => registered,
  readDatabase: async () => database,
  ensureDatabaseRow: async (site) => { inserted.push(site) },
})
assert.deepEqual(await resolveAttendanceWorksite('site-1', lookup(current, null)), { ...current, accuracyMeters: 0 })
assert.equal(inserted.length, 1, 'Missing SQL row must be repaired using the administrator registry')
assert.equal((await resolveAttendanceWorksite('site-1', lookup(current, { id: 'site-1', latitude: 50, longitude: 8 }))).latitude, 52.4)
assert.equal(inserted.length, 1, 'Existing SQL rows must not be overwritten by a clock-in')
assert.equal(await resolveAttendanceWorksite('site-1', lookup({ ...current, latitude: null }, current)), null)
assert.equal(await resolveAttendanceWorksite('site-1', lookup({ ...current, id: 'other' }, null)), null)
assert.equal(await resolveAttendanceWorksite('site-1', lookup(null, { ...current, latitude: null })), null)
assert.deepEqual(await resolveAttendanceWorksite('site-1', lookup(null, current)), current)
console.log('Registered worksite synchronization and coordinate validation passed')
