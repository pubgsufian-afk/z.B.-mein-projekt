import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-independent-timesheet-ui.mjs')
const [source, stampPage, app, legacyReport, cleanReport] = await Promise.all([
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
  readFile('frontend/src/TimesheetPage.jsx', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('netlify/functions/timesheet-reports.mts', 'utf8'),
  readFile('netlify/functions/timesheet-monthly-reports.mts', 'utf8'),
])
assert.match(source, /\/api\/timesheets/)
assert.match(source, /\/api\/timesheet-reports/)
assert.match(source, /manual-update/)
assert.doesNotMatch(source, /\/api\/attendance|mergeTimesheetRows|buildActualSessions/)
assert.match(stampPage, /\/api\/stamp-comparison-reports/)
assert.match(stampPage, /Stempelprotokoll PDF/)
assert.match(stampPage, /Stempelprotokoll Excel/)
assert.match(legacyReport, /path: '\/api\/stamp-comparison-reports'/)
assert.match(cleanReport, /path: '\/api\/timesheet-reports'/)
assert.match(app, /import TimesheetPage from '\.\/TimesheetMonthlyPage\.jsx'/)
assert.match(app, /import AttendanceTimesheetPage from '\.\/TimesheetPage\.jsx'/)
assert.match(app, /key: 'stamp-log', label: 'Stempelprotokoll'/)
assert.match(app, /page === 'stamp-log' \? <AttendanceTimesheetPage session=\{session\} \/>/)
console.log('independent timesheet and stamp-log routing source contract passed')
