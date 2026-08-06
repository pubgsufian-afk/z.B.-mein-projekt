import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const script = await readFile(new URL('../public/remove-employee-id.js', import.meta.url), 'utf8')
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
const directory = await readFile(new URL('../public/employee-directory-v2.js', import.meta.url), 'utf8')
const schedule = await readFile(new URL('../public/schedule-v2.js', import.meta.url), 'utf8')
const reports = await readFile(new URL('../public/reports-v2.js', import.meta.url), 'utf8')
const live = await readFile(new URL('../public/live-attendance.js', import.meta.url), 'utf8')

assert.match(index, /remove-employee-id\.js/)
assert.match(script, /Mitarbeiter\[-\\s\]\?ID|Mitarbeiter/)
assert.match(script, /Personalnummer/)
assert.match(script, /employeeId/)
assert.match(script, /employee_id/)
assert.match(script, /required = false/)
assert.match(script, /aria-hidden/)
assert.match(script, /MutationObserver/)
assert.match(directory, /\/api\/registrations/)
assert.match(directory, /fullName/)
assert.match(schedule, /<label>Mitarbeiter<select name="employeeUserId"/)
assert.match(schedule, /type="hidden" name="employeeName"/)
assert.match(reports, /name="employeeSelection" multiple/)
assert.match(live, /<label>Mitarbeiter<select data-live-user>/)
for (const source of [schedule, reports, live]) {
  assert.doesNotMatch(source, /Mitarbeiter-IDs?|Personalnummer|Einsatzort-ID/i)
}

console.log('Employee ID removal tests passed · 17 assertions')
