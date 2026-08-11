import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, timesheet, stampLog] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
  readFile('frontend/src/TimesheetPage.jsx', 'utf8'),
])

const navigation = app.match(/const NAVIGATION = \[(.*?)\]\n/s)?.[1] || ''
assert.ok(navigation, 'NAVIGATION block must exist')
assert.doesNotMatch(navigation, /key:\s*['"]reports['"]/, 'reports must not be in main navigation')
assert.doesNotMatch(navigation, /label:\s*['"]Berichte['"]/, 'Berichte must not be in main navigation')
assert.match(timesheet, /\/api\/timesheet-reports/, 'Stundenzettel PDF\/Excel must stay available')
assert.match(stampLog, /\/api\/stamp-comparison-reports/, 'Stempelprotokoll export\/comparison must stay available')

console.log('Reports navigation hidden contract passed')
