import assert from 'node:assert/strict'
import { parseScheduleCommand } from '../netlify/functions/_shared/schedule-command-worker-core.mts'

const now = new Date('2026-08-07T20:00:00.000Z')

const sync = parseScheduleCommand(JSON.stringify({
  version: 1,
  commandId: 'sync-1',
  createdAt: '2026-08-07T19:45:00.000Z',
  action: 'sync-directory',
}), now)
assert.equal(sync.ok, true)
assert.equal(sync.command?.action, 'sync-directory')

const publish = parseScheduleCommand(JSON.stringify({
  version: 1,
  commandId: 'publish-1',
  createdAt: '2026-08-07T19:50:00.000Z',
  action: 'publish-shifts',
  shifts: [{ employeeName: 'Mitarbeiter', date: '2026-08-08', start: '06:00', end: '17:00', workArea: 'ZuKo' }],
}), now)
assert.equal(publish.ok, true)
assert.equal(publish.command?.action, 'publish-shifts')
assert.equal(publish.command?.shifts?.length, 1)

for (const raw of [
  '',
  'not-json',
  JSON.stringify({ version: 2, commandId: 'x', createdAt: now.toISOString(), action: 'sync-directory' }),
  JSON.stringify({ version: 1, commandId: '', createdAt: now.toISOString(), action: 'sync-directory' }),
  JSON.stringify({ version: 1, commandId: 'x', createdAt: 'bad-date', action: 'sync-directory' }),
  JSON.stringify({ version: 1, commandId: 'x', createdAt: '2026-08-07T18:00:00.000Z', action: 'sync-directory' }),
  JSON.stringify({ version: 1, commandId: 'x', createdAt: now.toISOString(), action: 'delete-users' }),
  JSON.stringify({ version: 1, commandId: 'x', createdAt: now.toISOString(), action: 'publish-shifts' }),
]) {
  assert.equal(parseScheduleCommand(raw, now).ok, false)
}

console.log('Schedule command worker core tests passed')
