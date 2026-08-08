import assert from 'node:assert/strict'
import fs from 'node:fs'

const legacy = fs.readFileSync('netlify/functions/timesheet-reports.mts', 'utf8')
const unified = fs.readFileSync('netlify/functions/timesheet-export.mts', 'utf8')

assert.match(legacy, /scope === 'planned'/)
assert.match(legacy, /Stundenzettel – tatsächliche Arbeitszeiten/)
assert.match(legacy, /Dienstplanstunden – geplant/)
assert.match(legacy, /application\/pdf/)
assert.match(legacy, /spreadsheetml\.sheet/)

assert.match(unified, /path: '\/api\/timesheet-export'/)
assert.match(unified, /Arbeitszeitenbericht/)
assert.match(unified, /Gesamtdauer/)
assert.match(unified, /Anmerkungen/)
assert.match(unified, /opacity:\s*0\.0[5-9]/)
assert.match(unified, /employeeName/)
assert.match(unified, /source:\s*'planned'/)
assert.match(unified, /source:\s*'actual'/)
assert.match(unified, /Habun-Stundenzettel-/)
assert.match(unified, /application\/pdf/)
assert.match(unified, /spreadsheetml\.sheet/)

console.log('unified timesheet export source contract passed')
