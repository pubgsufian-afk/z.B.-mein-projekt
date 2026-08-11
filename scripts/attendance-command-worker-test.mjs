import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { parseScheduleCommand } from '../netlify/functions/_shared/schedule-command-worker-core.mts'

const now = new Date('2026-08-11T19:50:00.000Z')
const base = { version: 1, commandId: 'a1', createdAt: '2026-08-11T19:49:00.000Z' }
const responseKey = randomBytes(32).toString('base64')

let parsed = parseScheduleCommand(JSON.stringify({ ...base, action: 'list-attendance', from: '2026-08-01', to: '2026-08-12', responseKey }), now)
assert.equal(parsed.ok, true)
assert.equal(parsed.command.from, '2026-08-01')

parsed = parseScheduleCommand(JSON.stringify({ ...base, action: 'find-attendance-duplicates', from: '2026-08-01', to: '2026-08-12', responseKey }), now)
assert.equal(parsed.ok, true)

parsed = parseScheduleCommand(JSON.stringify({
  ...base,
  action: 'update-attendance-session',
  clockInEventId: 'in-1',
  clockOutEventId: 'out-1',
  clockInAt: '2026-08-10T06:00:00Z',
  clockOutAt: '2026-08-10T14:00:00Z',
  pauseMinutes: 60,
  reason: 'Korrektur',
  responseKey,
}), now)
assert.equal(parsed.ok, true)
assert.equal(parsed.command.pauseMinutes, 60)

parsed = parseScheduleCommand(JSON.stringify({ ...base, action: 'delete-attendance-events', eventIds: ['e1', 'e2'], reason: 'Doppelte Buchung', responseKey }), now)
assert.equal(parsed.ok, true)
assert.deepEqual(parsed.command.eventIds, ['e1', 'e2'])

let bad = parseScheduleCommand(JSON.stringify({ ...base, action: 'update-attendance-session', clockInEventId: 'in-1' }), now)
assert.equal(bad.ok, false)
bad = parseScheduleCommand(JSON.stringify({ ...base, action: 'delete-attendance-events', eventIds: Array.from({ length: 26 }, (_, i) => `e${i}`), reason: 'x' }), now)
assert.equal(bad.ok, false)
bad = parseScheduleCommand(JSON.stringify({ ...base, action: 'list-attendance', from: '2026-01-01', to: '2026-04-01', responseKey }), now)
assert.equal(bad.ok, false)
bad = parseScheduleCommand(JSON.stringify({ ...base, action: 'list-attendance', from: '2026-08-01', to: '2026-08-12' }), now)
assert.equal(bad.ok, false)
console.log('attendance command parser tests passed')
