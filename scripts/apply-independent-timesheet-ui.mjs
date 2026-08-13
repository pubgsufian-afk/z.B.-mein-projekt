import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
app = app.replace("import TimesheetPage from './TimesheetPage.jsx'\n", '')
if (!app.includes("import AttendanceTimesheetPage from './TimesheetPage.jsx'")) {
  const reactImport = "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n"
  assert.ok(app.includes(reactImport), 'React-Import für Stempelprotokoll fehlt.')
  app = app.replace(reactImport, `${reactImport}import AttendanceTimesheetPage from './TimesheetPage.jsx'\n`)
}
app = app.replace("import TimesheetPage from './TimesheetMonthlyPage.jsx'\n", '')
const attendanceImport = "import AttendanceTimesheetPage from './TimesheetPage.jsx'\n"
assert.ok(app.includes(attendanceImport), 'Stempelprotokoll-Import fehlt.')
app = app.replace(attendanceImport, `${attendanceImport}import TimesheetPage from './TimesheetMonthlyPage.jsx'\n`)
const timesheetNav = "  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager'] },"
const stampNav = "  { key: 'stamp-log', label: 'Stempelprotokoll', roles: ['owner', 'admin', 'manager'] },"
const reportsNav = "  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },"
assert.ok(app.includes(timesheetNav), 'Stundenzettel-Navigation fehlt.')
if (!app.includes(stampNav)) app = app.replace(timesheetNav, `${timesheetNav}\n${stampNav}`)
app = app.replace(`${reportsNav}\n`, '')
const timesheetRoute = ": page === 'timesheet' ? <TimesheetPage session={session} />"
const stampRoute = ": page === 'stamp-log' ? <AttendanceTimesheetPage session={session} />"
assert.ok(app.includes(timesheetRoute), 'Stundenzettel-Routing fehlt.')
if (!app.includes(stampRoute)) app = app.replace(timesheetRoute, `${timesheetRoute}\n        ${stampRoute}`)
await writeFile(appPath, app)

const monthlyPagePath = 'frontend/src/TimesheetMonthlyPage.jsx'
let monthlyPage = await readFile(monthlyPagePath, 'utf8')
if (monthlyPage.includes("'/api/timesheet-monthly-reports'")) {
  monthlyPage = monthlyPage.replace("'/api/timesheet-monthly-reports'", "'/api/timesheet-reports'")
  await writeFile(monthlyPagePath, monthlyPage)
}
assert.ok(monthlyPage.includes("'/api/timesheet-reports'"), 'Unabhängiger Stundenzettel-Export fehlt.')

const cleanReportPath = 'netlify/functions/timesheet-monthly-reports.mts'
let cleanReport = await readFile(cleanReportPath, 'utf8')
if (cleanReport.includes("path: '/api/timesheet-monthly-reports'")) {
  cleanReport = cleanReport.replace("path: '/api/timesheet-monthly-reports'", "path: '/api/timesheet-reports'")
  await writeFile(cleanReportPath, cleanReport)
}
assert.ok(cleanReport.includes("path: '/api/timesheet-reports'"), 'Standard-Stundenzettel-Reportpfad fehlt.')

const stampPagePath = 'frontend/src/TimesheetPage.jsx'
let stampPage = await readFile(stampPagePath, 'utf8')
if (stampPage.includes("'/api/timesheet-reports'")) stampPage = stampPage.replace("'/api/timesheet-reports'", "'/api/stamp-comparison-reports'")
stampPage = stampPage.replaceAll('Stundenzettel PDF', 'Stempelprotokoll PDF').replaceAll('Stundenzettel Excel', 'Stempelprotokoll Excel').replaceAll('Stundenzettel wurde erstellt.', 'Stempelprotokoll wurde erstellt.')
await writeFile(stampPagePath, stampPage)

const legacyReportPath = 'netlify/functions/timesheet-reports.mts'
let legacyReport = await readFile(legacyReportPath, 'utf8')
legacyReport = legacyReport.replace("path: '/api/timesheet-reports'", "path: '/api/stamp-comparison-reports'").replaceAll('Habun-Stundenzettel', 'Habun-Stempelprotokoll')
await writeFile(legacyReportPath, legacyReport)
assert.ok(legacyReport.includes("path: '/api/stamp-comparison-reports'"), 'Stempelprotokoll-Reportpfad fehlt.')

const pageTestPath = 'scripts/timesheet-page-source-test.mjs'
let pageTest = await readFile(pageTestPath, 'utf8')
pageTest = pageTest.replace(/\\\/api\\\/timesheet-reports/g, '\\/api\\/stamp-comparison-reports').replaceAll('Stundenzettel PDF', 'Stempelprotokoll PDF').replaceAll('Stundenzettel Excel', 'Stempelprotokoll Excel')
await writeFile(pageTestPath, pageTest)

const reportTestPath = 'scripts/timesheet-report-source-test.mjs'
let reportTest = await readFile(reportTestPath, 'utf8')
reportTest = reportTest.replace(/\\\/api\\\/timesheet-reports/g, '\\/api\\/stamp-comparison-reports').replaceAll('Habun-Stundenzettel', 'Habun-Stempelprotokoll')
await writeFile(reportTestPath, reportTest)

await import('./apply-professional-timesheet-excel.mjs')
await import('./apply-timesheet-reference-style.mjs')
await import('./timesheet-monthly-excel-style-source-test.mjs')
console.log('Independent monthly timesheet and stamp-report separation routed')