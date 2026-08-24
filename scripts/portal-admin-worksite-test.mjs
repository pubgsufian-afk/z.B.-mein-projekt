import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [adapter, service] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-worksites.mts', 'utf8'),
  readFile('netlify/functions/_shared/worksite-admin-service.mts', 'utf8'),
])
for (const action of ['list','get','save','delete','resolve-map']) assert.ok(adapter.includes(`'${action}'`), `missing ${action}`)
assert.match(adapter, /DESTRUCTIVE_CONFIRMATION_REQUIRED/)
assert.match(adapter, /confirm !== true/)
assert.match(service, /attendance_objects/)
assert.match(service, /scheduleReferenceCount/)
assert.doesNotMatch(service, /DELETE FROM schedule_shifts/)
console.log('portal admin worksite tests passed')
