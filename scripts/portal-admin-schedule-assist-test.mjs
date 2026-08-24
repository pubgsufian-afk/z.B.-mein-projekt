import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [service, adapter] = await Promise.all([
  readFile('netlify/functions/_shared/schedule-assist-admin-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-schedule.mts', 'utf8'),
])

assert.match(service, /portal-schedule-v2/)
for (const needle of ['templates/', 'shifts/', 'reviewWeek', 'suggestions', 'saveTemplate', 'deleteTemplate']) {
  assert.ok(service.includes(needle), `missing schedule assist service ${needle}`)
}
for (const action of ['list-templates', 'suggestions', 'review-week', 'save-template', 'delete-template']) {
  assert.ok(adapter.includes(`'${action}'`), `missing schedule assist relay action ${action}`)
}
assert.match(adapter, /DESTRUCTIVE_CONFIRMATION_REQUIRED/)
assert.match(adapter, /operation\.input\.confirm !== true/)
console.log('portal admin schedule assist tests passed')
