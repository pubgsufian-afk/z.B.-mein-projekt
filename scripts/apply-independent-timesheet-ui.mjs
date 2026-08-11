import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')

// Keep the legacy attendance editor available, but move it out of Stundenzettel.
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
assert.ok(app.includes(timesheetNav), 'Stundenzettel-Navigation fehlt.')
if (!app.includes(stampNav)) app = app.replace(timesheetNav, `${timesheetNav}\n${stampNav}`)

const timesheetRoute = ": page === 'timesheet' ? <TimesheetPage session={session} />"
const stampRoute = ": page === 'stamp-log' ? <AttendanceTimesheetPage session={session} />"
assert.ok(app.includes(timesheetRoute), 'Stundenzettel-Routing fehlt.')
if (!app.includes(stampRoute)) app = app.replace(timesheetRoute, `${timesheetRoute}\n        ${stampRoute}`)

await writeFile(appPath, app)

const pagePath = 'frontend/src/TimesheetMonthlyPage.jsx'
let page = await readFile(pagePath, 'utf8')
if (page.includes("'/api/timesheet-reports'")) {
  page = page.replace("'/api/timesheet-reports'", "'/api/timesheet-monthly-reports'")
  await writeFile(pagePath, page)
}
assert.ok(page.includes("'/api/timesheet-monthly-reports'"), 'Unabhängiger Stundenzettel-Export fehlt.')

console.log('Independent monthly timesheet UI and stamp-log compatibility routed')
