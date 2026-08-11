import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/timesheet-monthly-reports.mts', 'utf8')
assert.match(source, /listTimesheetEntries/)
assert.match(source, /syncPublishedScheduleRange/)
assert.doesNotMatch(source, /attendance_events|\/api\/attendance|schedule-v2|loadSchedules/)
assert.match(source, /application\/pdf/)
assert.match(source, /spreadsheetml\.sheet/)
console.log('independent timesheet report source contract passed')
