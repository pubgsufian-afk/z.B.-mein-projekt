import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [employees, aliases, health, capabilities, fullControl, aliasPatch] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-employees.mts', 'utf8'),
  readFile('netlify/functions/_shared/employee-alias-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-health.mts', 'utf8'),
  readFile('ops/portal-admin-capabilities-extra.json', 'utf8'),
  readFile('scripts/apply-schedule-assistant-full-control.mjs', 'utf8'),
  readFile('scripts/apply-schedule-alias-resolution.mjs', 'utf8'),
])

for (const action of ['list-aliases', 'save-alias', 'delete-alias', 'portal-health']) {
  assert.match(employees, new RegExp(`operation\\.action === '${action}'`))
}
assert.match(aliases, /consistency: 'strong'/)
assert.match(aliases, /ALIAS_CONFLICT/)
assert.match(health, /MAX_RANGE_DAYS = 62/)
assert.match(health, /guestIdentityIds/)
assert.match(health, /unknownEmployeeIds/)
assert.match(health, /exactDuplicatePairs/)
assert.match(health, /invalidWorksiteReferences/)
assert.match(health, /noncanonicalWorkAreas/)
assert.match(health, /attendanceUnknownIdentityEvents/)

for (const id of [
  'employees.list-aliases',
  'employees.save-alias',
  'employees.delete-alias',
  'employees.portal-health',
]) {
  assert.ok(capabilities.includes(`"${id}"`), `missing capability ${id}`)
}
assert.match(fullControl, /apply-schedule-alias-resolution\.mjs/)
assert.match(aliasPatch, /listEmployeeAliases/)
assert.match(aliasPatch, /resolveAssistantEmployeeWithAliases/)

await import('./employee-alias-resolution-test.mjs')
console.log('Portal admin reliability tests passed')
