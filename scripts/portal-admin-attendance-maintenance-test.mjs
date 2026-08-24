import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [service, adapter] = await Promise.all([
  readFile('netlify/functions/_shared/attendance-maintenance-admin-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-attendance.mts', 'utf8'),
])

for (const needle of [
  'attendance_corrections',
  'attendance_correction_decisions',
  'attendance_audit_log',
  'attendance_legal_holds',
  "interval '24 months'",
]) assert.ok(service.includes(needle), `missing maintenance rule ${needle}`)

for (const action of ['list-corrections', 'decide-correction', 'retention-dry-run', 'retention-apply']) {
  assert.ok(adapter.includes(`'${action}'`), `missing attendance maintenance action ${action}`)
}
assert.match(adapter, /operation\.input\.confirm !== true/)
assert.match(adapter, /DESTRUCTIVE_CONFIRMATION_REQUIRED/)
console.log('portal admin attendance maintenance tests passed')
