import fs from 'node:fs'
import assert from 'node:assert/strict'

const repository = fs.readFileSync('netlify/functions/_shared/timesheet-repository.mts', 'utf8')
const manual = fs.readFileSync('netlify/functions/_shared/timesheet-manual-repository.mts', 'utf8')

assert.match(repository, /suppressed:\s*Boolean\(row\.suppressed\)/)
assert.match(repository, /WHERE work_date BETWEEN[\s\S]*suppressed = false/)
assert.match(repository, /WHERE timesheet_entries\.manual_override = false[\s\S]*timesheet_entries\.suppressed = false/)
assert.match(manual, /export async function suppressTimesheetEntry/)
assert.match(manual, /suppressed = true/)
assert.match(manual, /manual_override = true/)
assert.match(manual, /export async function restoreScheduleTimesheetEntry/)
assert.match(manual, /suppressed = false/)
assert.match(manual, /manual_override = false/)
assert.match(manual, /source = 'schedule'/)
console.log('timesheet suppression repository source contract passed')
