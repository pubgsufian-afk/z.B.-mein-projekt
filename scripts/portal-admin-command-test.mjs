import assert from 'node:assert/strict'
import { parsePortalAdminCommand } from '../netlify/functions/_shared/portal-admin-command-core.mts'

const now = new Date('2026-08-24T16:00:00.000Z')
const responseKey = Buffer.alloc(32, 9).toString('base64')
const base = {
  version: 1,
  commandId: 'portal-1',
  createdAt: '2026-08-24T15:55:00.000Z',
  responseKey,
}

const inspect = parsePortalAdminCommand(JSON.stringify({
  ...base,
  domain: 'portal',
  action: 'inspect',
  input: { employeeName: 'Test Person', from: '2026-08-01', to: '2026-08-24' },
}), now)
assert.equal(inspect.ok, true)
assert.equal(inspect.command.domain, 'portal')
assert.equal(inspect.command.action, 'inspect')

const batch = parsePortalAdminCommand(JSON.stringify({
  ...base,
  commandId: 'portal-batch-1',
  domain: 'portal',
  action: 'portal-batch',
  reason: 'Korrektur',
  operations: [
    { itemId: '1', domain: 'schedule', action: 'update-shift', input: { shiftId: 's1', changes: { pauseMinutes: 30 } } },
    { itemId: '2', domain: 'attendance', action: 'update-session', input: { clockInEventId: 'i1', clockOutEventId: 'o1' } },
  ],
}), now)
assert.equal(batch.ok, true)
assert.equal(batch.command.operations.length, 2)
assert.equal(batch.command.reason, 'Korrektur')

const invalid = [
  '',
  'not-json',
  JSON.stringify({ ...base, version: 2, domain: 'portal', action: 'inspect' }),
  JSON.stringify({ ...base, commandId: '', domain: 'portal', action: 'inspect' }),
  JSON.stringify({ ...base, createdAt: 'bad', domain: 'portal', action: 'inspect' }),
  JSON.stringify({ ...base, createdAt: '2026-08-24T15:29:59.000Z', domain: 'portal', action: 'inspect' }),
  JSON.stringify({ ...base, responseKey: '', domain: 'portal', action: 'inspect' }),
  JSON.stringify({ ...base, responseKey: 'bad', domain: 'portal', action: 'inspect' }),
  JSON.stringify({ ...base, domain: 'unknown', action: 'inspect' }),
  JSON.stringify({ ...base, domain: 'portal', action: '' }),
  JSON.stringify({ ...base, domain: 'portal', action: 'inspect', input: [] }),
  JSON.stringify({ ...base, domain: 'portal', action: 'inspect', operations: [] }),
  JSON.stringify({ ...base, domain: 'portal', action: 'portal-batch', operations: [] }),
  JSON.stringify({
    ...base,
    domain: 'portal', action: 'portal-batch',
    operations: [
      { itemId: 'same', domain: 'schedule', action: 'x', input: {} },
      { itemId: 'same', domain: 'schedule', action: 'y', input: {} },
    ],
  }),
  JSON.stringify({
    ...base,
    domain: 'portal', action: 'portal-batch',
    operations: [{ itemId: 'x', domain: 'unknown', action: 'x', input: {} }],
  }),
  JSON.stringify({
    ...base,
    domain: 'portal', action: 'portal-batch',
    operations: Array.from({ length: 101 }, (_, index) => ({ itemId: String(index), domain: 'schedule', action: 'x', input: {} })),
  }),
]
for (const raw of invalid) {
  const result = parsePortalAdminCommand(raw, now)
  assert.equal(result.ok, false, `Expected invalid: ${raw.slice(0, 120)}`)
}

const oversized = JSON.stringify({
  ...base,
  domain: 'portal',
  action: 'inspect',
  input: { value: 'x'.repeat(400_001) },
})
assert.equal(parsePortalAdminCommand(oversized, now).ok, false)

console.log('portal admin command parser tests passed')
