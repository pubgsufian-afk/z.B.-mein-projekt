import assert from 'node:assert/strict'
import registry from '../ops/portal-admin-capabilities.json' with { type: 'json' }
import {
  portalAdminActionAllowed,
  portalAdminCapability,
} from '../netlify/functions/_shared/portal-admin-capabilities.mts'

const classifications = new Set(['relay-supported', 'relay-read-only', 'excluded-security'])
assert.ok(Array.isArray(registry) && registry.length > 0)
assert.equal(new Set(registry.map((row) => row.id)).size, registry.length)

for (const row of registry) {
  assert.ok(row.id && row.surface && row.endpoint && row.method && row.action, `incomplete row ${row.id}`)
  assert.ok(classifications.has(row.classification), row.id)
  if (row.classification !== 'excluded-security') {
    assert.ok(row.relay?.domain && row.relay?.action, `missing relay mapping ${row.id}`)
  }
}

for (const id of [
  'schedule.publish-shifts',
  'schedule.list-shifts',
  'schedule.update-shift',
  'schedule.delete-shift',
  'attendance.list',
  'attendance.update-session',
  'attendance.delete-events',
]) assert.ok(registry.some((row) => row.id === id), `missing ${id}`)

assert.equal(portalAdminActionAllowed('schedule', 'publish-shifts'), true)
assert.equal(portalAdminActionAllowed('attendance', 'update-session'), true)
assert.equal(portalAdminActionAllowed('employees', 'get'), false)
assert.equal(portalAdminCapability('attendance', 'list')?.id, 'attendance.list')

console.log('portal admin capability registry tests passed')
