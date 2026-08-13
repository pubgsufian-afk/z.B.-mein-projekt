import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [report, api, page] = await Promise.all([
  readFile('netlify/functions/timesheet-monthly-reports.mts', 'utf8'),
  readFile('netlify/functions/timesheets.mts', 'utf8'),
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
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
