import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
app = app
  .replace("import TimesheetPage from './TimesheetPage.jsx'\n", '')
  .replace("import TimesheetPage from './TimesheetMonthlyPage.jsx'\n", '')
const reactImport = "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\n"
assert.ok(app.includes(reactImport), 'React-Import für Stundenzettel-Routing fehlt.')
app = app.replace(reactImport, `${reactImport}import TimesheetPage from './TimesheetMonthlyPage.jsx'\n`)
await writeFile(appPath, app)

const pagePath = 'frontend/src/TimesheetMonthlyPage.jsx'
let page = await readFile(pagePath, 'utf8')
if (page.includes("'/api/timesheet-reports'")) {
  page = page.replace("'/api/timesheet-reports'", "'/api/timesheet-monthly-reports'")
  await writeFile(pagePath, page)
}
assert.ok(page.includes("'/api/timesheet-monthly-reports'"), 'Unabhängiger Stundenzettel-Export fehlt.')

console.log('Independent monthly timesheet UI routed')
