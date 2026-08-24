import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [service, adapter] = await Promise.all([
  readFile('netlify/functions/_shared/timesheet-admin-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-attendance.mts', 'utf8'),
])

for (const needle of [
  'listTimesheetEntries',
  'listSuppressedTimesheetEntries',
  'createManualTimesheetEntry',
  'updateManualTimesheetEntry',
  'suppressTimesheetEntry',
  'restoreScheduleTimesheetEntry',
  'writeTimesheetAudit',
  'isTimesheetScheduleSyncOpen',
]) assert.ok(service.includes(needle), `missing timesheet admin service rule ${needle}`)

for (const action of [
  'timesheet-list',
  'timesheet-manual-create',
  'timesheet-manual-update',
  'timesheet-manual-delete',
  'timesheet-restore-schedule',
]) assert.ok(adapter.includes(`'${action}'`), `missing timesheet relay action ${action}`)

assert.match(adapter, /DESTRUCTIVE_CONFIRMATION_REQUIRED/)
assert.match(adapter, /operation\.input\.confirm !== true/)
console.log('portal admin monthly timesheet tests passed')
