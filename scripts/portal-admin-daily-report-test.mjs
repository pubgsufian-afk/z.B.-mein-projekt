import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [service, adapter] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-daily-report-service.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-reports.mts', 'utf8'),
])

for (const needle of [
  'listDailyReports',
  'findDailyReportById',
  'reportStore',
  'MAX_REPORT_WORDS',
  'createDailyReportAdmin',
  'updateDailyReportAdmin',
  'deleteDailyReportAdmin',
  'generateDailyReportAdminPdf',
]) assert.ok(service.includes(needle), `missing daily report service marker ${needle}`)

for (const action of ['daily-list', 'daily-create', 'daily-update', 'daily-delete', 'daily-export']) {
  assert.ok(adapter.includes(`'${action}'`), `missing report adapter action ${action}`)
}
assert.match(adapter, /DESTRUCTIVE_CONFIRMATION_REQUIRED/)

console.log('portal admin daily report tests passed')
