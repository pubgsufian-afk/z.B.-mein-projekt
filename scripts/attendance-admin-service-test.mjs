import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createAttendanceAdminService } from '../netlify/functions/_shared/attendance-admin-service.mts'

const calls = []
const service = createAttendanceAdminService({
  async createSession(input, actor) {
    calls.push(['create', input, actor])
    return { saved: true, clockInEventId: 'in1', clockOutEventId: 'out1' }
  },
  async updateSession(input, actor) {
    calls.push(['update', input, actor])
    return { saved: true }
  },
  async deleteEvents(input, actor) {
    calls.push(['delete', input, actor])
    return { deletedIds: input.eventIds }
  },
})

const actor = { userId: 'portal-admin-relay', email: 'portal-admin-relay@internal.invalid', role: 'owner' }
assert.equal((await service.createSession({
  userId: 'u1',
  clockInAt: '2026-08-20T06:00:00Z',
  clockOutAt: '2026-08-20T14:00:00Z',
  pauseMinutes: 30,
}, actor)).saved, true)
assert.equal((await service.updateSession({
  clockInEventId: 'i',
  clockOutEventId: 'o',
  clockInAt: '2026-08-20T06:00:00Z',
  clockOutAt: '2026-08-20T14:00:00Z',
  pauseMinutes: 30,
  reason: 'Korrektur',
}, actor)).saved, true)
assert.deepEqual((await service.deleteEvents({ eventIds: ['e1'], reason: 'Fehleintrag' }, actor)).deletedIds, ['e1'])
assert.equal(calls.length, 3)

const [createEndpoint, editEndpoint, assistant] = await Promise.all([
  readFile('netlify/functions/attendance-time-create.mts', 'utf8'),
  readFile('netlify/functions/attendance-time-edit.mts', 'utf8'),
  readFile('netlify/functions/attendance-assistant.mts', 'utf8'),
])
for (const source of [createEndpoint, editEndpoint, assistant]) {
  assert.match(source, /attendance-admin-service\.mts/)
}
assert.doesNotMatch(createEndpoint, /pg_advisory_xact_lock|INSERT INTO attendance_events/)
assert.doesNotMatch(editEndpoint, /INSERT INTO attendance_adjustments|INSERT INTO attendance_audit_log/)
assert.match(assistant, /attendanceAdminService\(\)/)
assert.match(assistant, /updateSession/)
assert.match(assistant, /deleteEvents/)

console.log('attendance admin service tests passed')
