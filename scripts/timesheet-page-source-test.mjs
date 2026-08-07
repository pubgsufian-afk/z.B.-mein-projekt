import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('frontend/src/TimesheetPage.jsx', 'utf8')

assert.match(page, /Arbeitsstunden – tatsächlich/)
assert.match(page, /Dienstplanstunden – geplant/)
assert.match(page, /Arbeitszeit eintragen/)
assert.match(page, /\/api\/attendance-time-edit/)
assert.match(page, /\/api\/attendance-time-create/)
assert.match(page, /scope:\s*'actual'/)
assert.match(page, /scope:\s*'planned'/)
assert.match(page, /Ist-Stunden PDF/)
assert.match(page, /Dienstplanstunden Excel/)
assert.doesNotMatch(page, /Begründung/)
assert.doesNotMatch(page, /Korrektur beantragen/)

console.log('timesheet page source contract passed')
