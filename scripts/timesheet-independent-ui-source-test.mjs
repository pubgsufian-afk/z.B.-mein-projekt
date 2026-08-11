import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-independent-timesheet-ui.mjs')
const [source, app] = await Promise.all([
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])
assert.match(source, /\/api\/timesheets/)
assert.match(source, /\/api\/timesheet-monthly-reports/)
assert.match(source, /manual-update/)
assert.doesNotMatch(source, /\/api\/attendance|mergeTimesheetRows|buildActualSessions/)
assert.match(app, /import TimesheetPage from '\.\/TimesheetMonthlyPage\.jsx'/)
assert.match(app, /import AttendanceTimesheetPage from '\.\/TimesheetPage\.jsx'/)
assert.match(app, /key: 'stamp-log', label: 'Stempelprotokoll'/)
assert.match(app, /page === 'stamp-log' \? <AttendanceTimesheetPage session=\{session\} \/>/)
console.log('independent timesheet and stamp-log routing source contract passed')
