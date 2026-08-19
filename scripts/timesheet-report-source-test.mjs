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

const augustCorrectionPath = 'netlify/database/migrations/20260819110500_fix-august-pauses-and-mohamad-identity/migration.sql'
assert.equal(fs.existsSync(augustCorrectionPath), true, 'August pause/identity correction migration must exist')
const augustCorrection = fs.readFileSync(augustCorrectionPath, 'utf8')
assert.match(augustCorrection, /\('Amin Khalaf Kije',\s*30\)/)
assert.match(augustCorrection, /\('Almusa',\s*60\)/)
assert.match(augustCorrection, /\('Amjad',\s*60\)/)
assert.match(augustCorrection, /\('Kanee',\s*60\)/)
assert.match(augustCorrection, /Mohamad/)
assert.match(augustCorrection, /\('Mohamed Ahmed warsame',\s*60\)/)
assert.match(augustCorrection, /employee_user_id\s*=\s*canonical_mohamed_user_id/)

console.log('unified timesheet export source contract passed')
