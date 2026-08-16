import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/timesheet-monthly-reports.mts', 'utf8')

assert.match(source, /listTimesheetEntries/)
assert.match(source, /syncPublishedScheduleRange/)
assert.match(source, /const key = `\$\{row\.employeeUserId\}\|\$\{row\.employeeName\}`/)
assert.match(source, /employeeRows\[0\]\?\.employeeName/)
assert.match(source, /sheet\.addRow\(\['Stundenzettel', employeeName\]\)/)
assert.match(source, /row\.workArea, row\.location/)
assert.match(source, /rows = await listTimesheetEntries\(\{ from, to,/)
assert.doesNotMatch(source, /\/api\/registrations/)
assert.doesNotMatch(source, /schedule_employees/)
assert.doesNotMatch(source, /employeeUserId\.startsWith\(['"]guest:/)
assert.doesNotMatch(source, /guest:.*filter/)

console.log('timesheet provisional report source contract passed')
