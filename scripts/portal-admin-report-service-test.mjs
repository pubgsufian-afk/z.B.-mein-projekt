import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/_shared/portal-admin-report-service.mts', 'utf8')
for (const needle of [
  'listScheduleShifts',
  'databaseConnectionString',
  'attendance_events',
  'attendance_adjustments',
  'readCompanySettings',
  'loadOriginalLogo',
  'generateTimesheetAdminExport',
  'generateScheduleAdminExport',
  "format === 'xlsx'",
  'NO_DATA',
]) assert.ok(source.includes(needle), `missing ${needle}`)
assert.doesNotMatch(source, /fetch\(['\"]\/api\//)

console.log('portal admin report service tests passed')
