import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [adapter, service, trigger, capabilities] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-employees.mts', 'utf8'),
  readFile('netlify/functions/_shared/employee-admin-service.mts', 'utf8'),
  readFile('netlify/functions/schedule-oidc-trigger.mts', 'utf8'),
  readFile('ops/portal-admin-capabilities.json', 'utf8'),
])
for (const action of ['get', 'list', 'update-profile', 'update-role', 'deactivate-account']) {
  assert.ok(adapter.includes(`'${action}'`), `missing employee action ${action}`)
}
assert.match(adapter, /role: 'owner'/)
assert.doesNotMatch(adapter, /password|access_token|refresh_token/i)
assert.match(service, /employeeManagementPolicy/)
assert.match(service, /access\/\$\{userId\}/)
assert.match(trigger, /employees: createEmployeePortalAdminHandler\(\)/)
for (const id of ['employees.get','employees.list','employees.update-profile','employees.update-role','employees.deactivate-account']) {
  assert.ok(capabilities.includes(`"${id}"`), `missing ${id}`)
}
console.log('portal admin employee tests passed')
