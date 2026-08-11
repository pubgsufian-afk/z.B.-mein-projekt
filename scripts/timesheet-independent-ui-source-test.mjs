import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8')
assert.match(source, /\/api\/timesheets/)
assert.match(source, /\/api\/timesheet-reports/)
assert.match(source, /manual-update/)
assert.doesNotMatch(source, /\/api\/attendance|mergeTimesheetRows|buildActualSessions/)
console.log('independent timesheet ui source contract passed')
