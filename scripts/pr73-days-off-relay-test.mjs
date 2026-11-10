import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('netlify/functions/_shared/portal-admin-schedule.mts', 'utf8')
const dayOffService = readFileSync('netlify/functions/_shared/portal-admin-days-off.mts', 'utf8')
const registry = JSON.parse(readFileSync('ops/portal-admin-capabilities.json','utf8'))
const actions = ['list-days-off', 'batch-set-days-off']
for (const action of actions) {
  const item = registry.find((x) => x.id === 'schedule.' + action)
  assert.ok(item, 'Capability missing ' + action)
  assert.equal(item.relay.domain, 'schedule')
  assert.equal(item.relay.action, action)
  assert.ok(source.includes("operation.action === '" + action + "'"))
}
assert.match(dayOffService, /getDatabase\(\)/)
assert.match(dayOffService, /FROM schedule_days_off/)
assert.match(dayOffService, /INSERT INTO schedule_days_off/)
assert.match(dayOffService, /HABUN_SHIFT_CONFLICT/)
assert.match(dayOffService, /BEGIN/)
assert.match(dayOffService, /COMMIT/)
assert.match(dayOffService, /ROLLBACK/)
assert.match(dayOffService, /schedule_audit_log/)
assert.match(dayOffService, /schedule_shifts WHERE employee_user_id=\$1/)
assert.doesNotMatch(dayOffService, /DELETE FROM schedule_shifts/i)
assert.doesNotMatch(dayOffService, /UPDATE schedule_shifts SET/i)
console.log('PASS private PR73 days-off relay source and registered permissions')
