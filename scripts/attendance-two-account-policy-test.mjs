import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isFlexClockAccount } from '../netlify/functions/_shared/attendance-automation-policy.mts'
import { createAttendanceService } from '../netlify/functions/_shared/attendance-service.mts'

const allowed = ' MARWAN@example.test , DALAL@example.test '
assert.equal(isFlexClockAccount('marwan@example.test', allowed), true)
assert.equal(isFlexClockAccount('dalal@example.test', allowed), true)
assert.equal(isFlexClockAccount('OTHER@example.test', allowed), false)
assert.equal(isFlexClockAccount('marwan@example.test', 'marwan@example.test'), false)
assert.equal(isFlexClockAccount('marwan@example.test', 'marwan@example.test,marwan@example.test'), false)
assert.equal(isFlexClockAccount('marwan@example.test', 'marwan@example.test,dalal@example.test,other@example.test'), false)
assert.equal(isFlexClockAccount('marwan@example.test', ''), false)

const events = []
const repository = {
  async listEvents() { return events },
  async findObject() { return null },
  async commitClockEvent(record) {
    events.push(record.event)
    return { kind: 'created', response: { event: record.event, location: record.location } }
  },
}
const user = { userId: 'test-user-1', email: 'marwan@example.test', role: 'employee' }
const instant = '2026-11-14T12:00:00.000Z'
const payload = (action, num) => ({
  action,
  clientEventId: 'event-' + num,
  clientOccurredAt: instant,
  scheduleId: 'attendance-flex:test-user-1:event-1',
  objectId: 'habun-flex-remote-v1',
  location: null,
})

// Normal employee flow must continue to refuse locationless clock-in.
const normal = createAttendanceService({ repository, now: () => new Date(instant) })
await assert.rejects(
  normal.record(user, payload('clock-in', 1)),
  (error) => error.code === 'WORKSITE_NOT_CONFIGURED',
)
assert.equal(events.length, 0)

// Only the authenticated flex endpoint may opt into the server-side exception.
const flex = createAttendanceService({
  repository,
  now: () => new Date(instant),
  allowRemoteClockIn: true,
})
const start = await flex.record(user, payload('clock-in', 1))
assert.equal(start.event.locationStatus, 'unavailable')
assert.equal(start.event.userId, 'test-user-1')
await flex.record(user, payload('break-start', 2))
await flex.record(user, payload('break-end', 3))
await flex.record(user, payload('clock-out', 4))
assert.equal((await flex.getState(user)).phase, 'completed')
assert.equal(events.length, 4)

const [handler, serviceCode, policyCode, uiPatch] = await Promise.all([
  readFile('netlify/functions/attendance-flex.mts', 'utf8'),
  readFile('netlify/functions/_shared/attendance-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/attendance-automation-policy.mts', 'utf8'),
  readFile('scripts/apply-attendance-flex-ui.mjs', 'utf8'),
])
assert.match(handler, /configuredFlexEmails\(\)/)
assert.match(handler, /isFlexClockAccount\(current\.email, configuredFlexEmails\(\)\)/)
assert.match(handler, /if \(!eligible\) return json\(\{ message: 'Keine Berechtigung\.'/)
assert.match(handler, /verifyRequestOrigin\(request\)/)
assert.match(handler, /REMOTE_WORKSITE/)
assert.doesNotMatch(handler, /hasPublishedShiftForDate/)
assert.doesNotMatch(handler, /findAllowedWorksite/)
assert.match(handler, /activeFlexScheduleId/)
assert.match(handler, /location: null/)
assert.match(handler, /allowRemoteClockIn: true/)
assert.match(serviceCode, /!allowRemoteClockIn/)
assert.match(policyCode, /allowed\.length === 2 && new Set\(allowed\)\.size === 2/)
assert.match(uiPatch, /useFlexEndpoint \? '\/api\/attendance-flex' : '\/api\/attendance'/)
assert.match(uiPatch, /!useFlexEndpoint && action === 'clock-in'/)
console.log('Two-account remote attendance: negative access + full clock flow OK')
