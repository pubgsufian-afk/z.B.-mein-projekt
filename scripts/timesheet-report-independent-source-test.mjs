import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const reportPath = 'netlify/functions/timesheet-monthly-reports.mts'
const apiPath = 'netlify/functions/timesheets.mts'
const pagePath = 'frontend/src/TimesheetMonthlyPage.jsx'

let [report, api, page] = await Promise.all([
  readFile(reportPath, 'utf8'),
  readFile(apiPath, 'utf8'),
  readFile(pagePath, 'utf8'),
])

const oldExcelImport = "  const ExcelJS = await import('exceljs')"
const newExcelImport = "  const ExcelJSModule = await import('exceljs')\n  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule"
if (!report.includes(newExcelImport)) {
  assert.ok(report.includes(oldExcelImport), 'ExcelJS import in monthly report was not found')
  report = report.replace(oldExcelImport, newExcelImport)
}
report = report.replace('    await syncPublishedScheduleRange(from, to, access.current.userId, new Date())\n', '')

const getStartBefore = api.indexOf("if (request.method === 'GET')")
const getEndBefore = api.indexOf("if (!['POST', 'PATCH', 'DELETE'].includes(request.method))", getStartBefore)
assert.ok(getStartBefore >= 0 && getEndBefore > getStartBefore, 'Timesheet GET block was not found')
const getBlockBefore = api.slice(getStartBefore, getEndBefore)
const fastGetBlock = getBlockBefore.replace('      await syncPublishedScheduleRange(from, to, current.userId, now)\n', '')
api = api.slice(0, getStartBefore) + fastGetBlock + api.slice(getEndBefore)

page = page.replace(
  "import { peekCachedJson, refreshCachedJson } from './read-cache.js'",
  "import { dedupeInflightJson, peekCachedJson, refreshCachedJson } from './read-cache.js'",
)
const oldLoad = "      const data = await requestJson(`/api/timesheets?${params}`)"
const newLoad = "      const timesheetPath = `/api/timesheets?${params}`\n      const data = await dedupeInflightJson(timesheetPath, () => requestJson(timesheetPath))"
if (!page.includes(newLoad)) {
  assert.ok(page.includes(oldLoad), 'Monthly timesheet request was not found')
  page = page.replace(oldLoad, newLoad)
}

await Promise.all([
  writeFile(reportPath, report),
  writeFile(apiPath, api),
  writeFile(pagePath, page),
])

assert.match(report, /listTimesheetEntries/)
assert.match(report, /syncPublishedScheduleRange/)
assert.match(report, /path: '\/api\/timesheet-reports'/)
assert.doesNotMatch(report, /attendance_events|\/api\/attendance|schedule-v2|loadSchedules/)
assert.match(report, /application\/pdf/)
assert.match(report, /spreadsheetml\.sheet/)
assert.match(report, /const ExcelJSModule = await import\('exceljs'\)/)
assert.match(report, /const ExcelJS = ExcelJSModule\.default \?\? ExcelJSModule/)
const reportHandlerStart = report.indexOf('export default async function timesheetMonthlyReports')
assert.ok(reportHandlerStart >= 0, 'Monthly report handler was not found')
assert.doesNotMatch(report.slice(reportHandlerStart), /await syncPublishedScheduleRange\(from, to/)

const getStart = api.indexOf("if (request.method === 'GET')")
const getEnd = api.indexOf("if (!['POST', 'PATCH', 'DELETE'].includes(request.method))", getStart)
assert.ok(getStart >= 0 && getEnd > getStart, 'Timesheet GET block was not found')
assert.doesNotMatch(api.slice(getStart, getEnd), /syncPublishedScheduleRange/)

assert.match(page, /dedupeInflightJson/)
assert.match(page, /dedupeInflightJson\(timesheetPath, \(\) => requestJson\(timesheetPath\)\)/)

console.log('independent timesheet report, Excel and performance source contract passed')
