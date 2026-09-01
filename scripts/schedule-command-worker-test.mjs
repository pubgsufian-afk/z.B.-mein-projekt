import assert from 'node:assert/strict'
import { parseScheduleCommand } from '../netlify/functions/_shared/schedule-command-worker-core.mts'

const now = new Date('2026-08-11T16:00:00.000Z')
const base = { version: 1, createdAt: '2026-08-11T15:50:00.000Z' }
const responseKey = Buffer.alloc(32, 7).toString('base64')

const valid = [
  { ...base, commandId: 'sync-1', action: 'sync-directory' },
  { ...base, commandId: 'publish-1', action: 'publish-shifts', shifts: [{ employeeName: 'Aras', date: '2026-08-11', start: '06:00', end: '14:00', workArea: 'ZuKo' }] },
  { ...base, commandId: 'publish-guests-1', action: 'publish-shifts', allowUnregistered: true, shifts: [{ employeeName: 'Test Person', date: '2026-08-11', start: '06:00', end: '14:00', workArea: 'ZuKo' }] },
  { ...base, commandId: 'publish-approved-guest-1', action: 'publish-shifts', allowUnregistered: true, approvedUnregisteredNames: ['Guest Example'], shifts: [{ employeeName: 'Guest Example', date: '2026-08-11', start: '06:00', end: '14:00', workArea: 'ZuKo' }] },
  { ...base, commandId: 'list-1', action: 'list-shifts', from: '2026-08-01', to: '2026-08-11', employeeName: 'Aras', responseKey },
  { ...base, commandId: 'get-1', action: 'get-shift', shiftId: 'shift-1', responseKey },
  { ...base, commandId: 'dup-1', action: 'find-duplicates', from: '2026-08-01', to: '2026-08-11', responseKey },
  { ...base, commandId: 'update-1', action: 'update-shift', shiftId: 'shift-1', changes: { start: '07:00' }, responseKey },
  { ...base, commandId: 'delete-1', action: 'delete-shift', shiftId: 'shift-1', responseKey },
]
for (const input of valid) {
  const result = parseScheduleCommand(JSON.stringify(input), now)
  assert.equal(result.ok, true, `Expected valid action ${input.action}`)
  assert.equal(result.command?.action, input.action)
}
assert.equal(parseScheduleCommand(JSON.stringify(valid[1]), now).command?.shifts?.length, 1)
assert.equal(parseScheduleCommand(JSON.stringify(valid[1]), now).command?.allowUnregistered, undefined)
assert.equal(parseScheduleCommand(JSON.stringify(valid[2]), now).command?.allowUnregistered, true)
assert.deepEqual(parseScheduleCommand(JSON.stringify(valid[3]), now).command?.approvedUnregisteredNames, ['Guest Example'])
assert.equal(parseScheduleCommand(JSON.stringify(valid[4]), now).command?.from, '2026-08-01')
assert.equal(parseScheduleCommand(JSON.stringify(valid[4]), now).command?.responseKey, responseKey)
assert.equal(parseScheduleCommand(JSON.stringify(valid[5]), now).command?.shiftId, 'shift-1')
assert.deepEqual(parseScheduleCommand(JSON.stringify(valid[7]), now).command?.changes, { start: '07:00' })

const invalid = [
  '',
  'not-json',
  JSON.stringify({ ...base, version: 2, commandId: 'x', action: 'sync-directory' }),
  JSON.stringify({ ...base, commandId: '', action: 'sync-directory' }),
  JSON.stringify({ ...base, commandId: 'x', createdAt: 'bad-date', action: 'sync-directory' }),
  JSON.stringify({ ...base, commandId: 'x', createdAt: '2026-08-11T14:00:00.000Z', action: 'sync-directory' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'delete-users' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'publish-shifts' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'publish-shifts', allowUnregistered: 'true', shifts: [{ employeeName: 'Test Person' }] }),
  JSON.stringify({ ...base, commandId: 'x', action: 'publish-shifts', approvedUnregisteredNames: 'Guest Example', shifts: [{ employeeName: 'Guest Example' }] }),
  JSON.stringify({ ...base, commandId: 'x', action: 'publish-shifts', approvedUnregisteredNames: [''], shifts: [{ employeeName: 'Guest Example' }] }),
  JSON.stringify({ ...base, commandId: 'x', action: 'publish-shifts', approvedUnregisteredNames: ['Guest Example', 'Guest Example'], shifts: [{ employeeName: 'Guest Example' }] }),
  JSON.stringify({ ...base, commandId: 'x', action: 'get-shift' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'update-shift', shiftId: 'shift-1' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'delete-shift' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'list-shifts', from: '11.08.2026', to: '2026-08-11' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'find-duplicates', from: '2026-08-12', to: '2026-08-11' }),
  JSON.stringify({ ...base, commandId: 'x', action: 'list-shifts', from: '2026-08-01', to: '2026-08-11', responseKey: 'bad' }),
]
for (const raw of invalid) assert.equal(parseScheduleCommand(raw, now).ok, false)

console.log('Schedule command worker core tests passed')
