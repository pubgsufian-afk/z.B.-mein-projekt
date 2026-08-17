import assert from 'node:assert/strict'

await import('./apply-attendance-system-actor.mjs')
const { createAttendanceService } = await import('../netlify/functions/_shared/attendance-service.mts')

const events = [{
  id: 'start', userId: 'employee-1', clientEventId: 'start', action: 'clock-in',
  clientOccurredAt: '2026-08-17T18:00:00.000Z', serverOccurredAt: '2026-08-17T18:00:00.000Z',
  eventDate: '2026-08-17', scheduleId: 'shift-1', objectId: 'site-1', locationStatus: 'inside', offlineCaptured: false,
}]
let captured = null
const repository = {
  async listEvents() { return events },
  async findIdempotency() { return null },
  async findObject() { return null },
  async commitClockEvent(record) {
    captured = record
    events.push(record.event)
    return { kind: 'created', response: { event: record.event, location: record.location, replayed: false } }
  },
  async listHistory() { return [] },
  async listLive() { return [] },
}
const service = createAttendanceService({ repository, now: () => new Date('2026-08-17T20:31:00.000Z'), randomUUID: () => 'auto-out' })
const actor = { userId: 'employee-1', actorId: 'system:auto-checkout', email: 'system@habun.invalid', role: 'system' }
await service.record(actor, {
  action: 'clock-out', clientEventId: 'auto:out', clientOccurredAt: '2026-08-17T20:30:00.000Z',
  scheduleId: 'shift-1', objectId: 'site-1', offlineCaptured: false, location: null,
})
assert.equal(captured.userId, 'employee-1')
assert.equal(captured.actorId, 'system:auto-checkout')
assert.equal(captured.actorRole, 'system')
assert.equal(captured.event.action, 'clock-out')
assert.equal(captured.event.clientOccurredAt, '2026-08-17T20:30:00.000Z')
await assert.rejects(() => service.getHistory(actor), (error) => error?.code === 'FORBIDDEN')

console.log('audited system attendance actor: ok')
