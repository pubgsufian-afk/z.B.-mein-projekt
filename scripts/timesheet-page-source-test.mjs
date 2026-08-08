import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('frontend/src/TimesheetPage.jsx', 'utf8')

assert.match(page, /mergeTimesheetRows/)
assert.match(page, /Dienstplanstunden werden automatisch/)
assert.match(page, /\/api\/attendance-time-edit/)
assert.match(page, /\/api\/attendance-time-create/)
assert.match(page, /\/api\/timesheet-reports/)
assert.match(page, /scope:\s*'unified'/)
assert.doesNotMatch(page, /\/api\/timesheet-export/)
assert.match(page, /scheduleId/)
assert.match(page, /Aus Dienstplan/)
assert.match(page, /Stundenzettel PDF/)
assert.match(page, /Stundenzettel Excel/)
assert.doesNotMatch(page, /Arbeitsstunden – tatsächlich/)
assert.doesNotMatch(page, /Dienstplanstunden – geplant/)
assert.doesNotMatch(page, /Begründung/)
assert.doesNotMatch(page, /Korrektur beantragen/)

console.log('unified timesheet page source contract passed')
