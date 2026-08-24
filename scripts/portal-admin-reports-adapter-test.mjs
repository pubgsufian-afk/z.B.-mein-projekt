import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/_shared/portal-admin-reports.mts', 'utf8')
for (const needle of [
  'generateTimesheetAdminExport',
  'generateScheduleAdminExport',
  'spoolPortalAdminExport',
  'context.responseKey',
  "operation.action === 'timesheet-export'",
  "operation.action === 'stamp-comparison-export'",
  "operation.action === 'schedule-export'",
  'Habun-Stempelprotokoll',
  'export:',
]) assert.ok(source.includes(needle), `missing ${needle}`)
assert.doesNotMatch(source, /ciphertext|pdfLogoDataUrl|console\.log/)

console.log('portal admin reports adapter tests passed')
