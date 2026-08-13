import assert from 'node:assert/strict'
import fs from 'node:fs'

const report = fs.readFileSync('netlify/functions/timesheet-reports.mts', 'utf8')

assert.match(report, /path: '\/api\/timesheet-reports'/)
assert.match(report, /scope === 'unified'|scope:\s*Scope\s*=.*unified/)
assert.match(report, /Arbeitszeitenbericht/)
assert.match(report, /Gesamtdauer/)
assert.match(report, /Anmerkungen/)
assert.match(report, /opacity:\s*0\.0[5-9]/)
assert.match(report, /employeeName/)
assert.match(report, /source:\s*'planned'/)
assert.match(report, /source:\s*'actual'/)
assert.match(report, /Habun-Stundenzettel/)
assert.match(report, /application\/pdf/)
assert.match(report, /spreadsheetml\.sheet/)
assert.match(report, /ExcelJSModule\.default/)
assert.equal(fs.existsSync('netlify/functions/timesheet-export.mts'), false)

console.log('unified timesheet export source contract passed')
