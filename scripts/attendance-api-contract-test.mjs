import assert from 'node:assert/strict'
import { createAttendanceService, eventDateInBerlin, normalizeClockRequest } from '../netlify/functions/_shared/attendance-service.mts'

assert.equal(eventDateInBerlin('2026-08-05T22:30:00.000Z'), '2026-08-06')
assert.equal(eventDateInBerlin('2026-12-31T23:30:00.000Z'), '2027-01-01')
assert.throws(() => normalizeClockRequest({ action: 'pause' }), /Ungültige Stempelaktion/)
assert.throws(() => normalizeClockRequest({ action: 'clock-in', clientEventId: '', clientOccurredAt: new Date().toISOString() }), /Buchungs-ID/)

function fakeRepository() {
  const events = []
  const idempotency = new Map()
  return {
    events,
    async listEvents(userId) { return events.filter((event) => event.userId === userId) },
    async findIdempotency(userId, clientEventId) { return idempotency.get(`${userId}:${clientEventId}`) || null },
    async findObject(objectId) {
      if (objectId === 'inside-site') return { id: objectId, latitude: 52.375, longitude: 9.732, radiusMeters: 500 }
      if (objectId === 'outside-site') return { id: objectId, latitude: 53, longitude: 10, radiusMeters: 500 }
      return null
    },
    async commitClockEvent(record) {
      const key = `${record.userId}:${record.clientEventId}`
      const existing = idempotency.get(key)
      if (existing) {
        if (existing.requestHash !== record.requestHash) return { kind: 'conflict' }
        return { kind: 'replay', response: { ...existing.response, replayed: true } }
      }
      const response = { event: record.event, location: record.location, replayed: false }
      idempotency.set(key, { requestHash: record.requestHash, response })
      events.push(record.event)
      return { kind: 'created', response }
    },
    async listHistory({ userId }) { return events.filter((event) => event.userId === userId) },
    async listLive() { return events },
  }
}

const repository = fakeRepository()
const service = createAttendanceService({
  repository,
  now: () => new Date('2026-08-06T08:05:00.000Z'),
  randomUUID: () => `server-${repository.events.length + 1}`,
})
const employee = { userId: 'employee-1', email: 'employee@example.com', role: 'employee' }
const manager = { userId: 'manager-1', email: 'manager@example.com', role: 'manager' }

await assert.rejects(() => service.getLive(employee, {}), /Keine Berechtigung/)
assert.deepEqual(await service.getLive(manager, {}), { entries: [] })

const clockInPayload = {
  action: 'clock-in',
  clientEventId: 'client-1',
  clientOccurredAt: '2026-08-06T08:00:00.000Z',
  objectId: 'inside-site',
  scheduleId: 'shift-1',
  offlineCaptured: false,
  location: { latitude: 52.375, longitude: 9.732, accuracyMeters: 12 },
}
const clockIn = await service.record(employee, clockInPayload)
assert.equal(clockIn.event.action, 'clock-in')
assert.equal(clockIn.event.locationStatus, 'inside')
assert.equal(clockIn.location.distanceMeters, 0)
assert.equal(clockIn.replayed, false)

const replay = await service.record(employee, clockInPayload)
assert.equal(replay.replayed, true)
await assert.rejects(() => service.record(employee, { ...clockInPayload, action: 'clock-out' }), /Buchungs-ID wurde bereits/)
await assert.rejects(() => service.record(employee, { ...clockInPayload, clientEventId: 'client-2' }), /Arbeitsbeginn wurde bereits/)

const clockOut = await service.record(employee, {
  action: 'clock-out', clientEventId: 'client-3', clientOccurredAt: '2026-08-06T17:00:00.000Z',
  objectId: 'outside-site', scheduleId: 'shift-1', offlineCaptured: true,
  location: { latitude: 52.375, longitude: 9.732, accuracyMeters: 20 },
})
assert.equal(clockOut.event.locationStatus, 'outside')
assert.equal(clockOut.event.offlineCaptured, true)

const state = await service.getState(employee)
assert.equal(state.phase, 'completed')
assert.equal(state.events.length, 2)
await assert.rejects(() => service.getHistory(employee, { userId: 'employee-1' }), /Keine Berechtigung/)
assert.deepEqual(await service.getHistory(manager, { userId: 'employee-1' }), { entries: repository.events })

const repository2 = fakeRepository()
const service2 = createAttendanceService({ repository: repository2, now: () => new Date('2026-08-06T08:00:00.000Z'), randomUUID: () => 'server-1' })
await assert.rejects(() => service2.record(employee, {
  action: 'clock-out', clientEventId: 'client-x', clientOccurredAt: '2026-08-06T08:00:00.000Z', location: null,
}), /Arbeitsende ohne Arbeitsbeginn/)
const unavailable = await service2.record(employee, {
  action: 'clock-in', clientEventId: 'client-y', clientOccurredAt: '2026-08-06T08:00:00.000Z', objectId: 'missing', location: null,
})
assert.equal(unavailable.event.locationStatus, 'unavailable')

console.log('Attendance API contract tests passed · 25 assertions')
