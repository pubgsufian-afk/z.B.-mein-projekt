import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('netlify/functions/timesheet-reports.mts', 'utf8')

assert.match(source, /scope === 'planned'/)
assert.match(source, /Stundenzettel – tatsächliche Arbeitszeiten/)
assert.match(source, /Dienstplanstunden – geplant/)
assert.match(source, /Habun-Stundenzettel-/)
assert.match(source, /Habun-Dienstplanstunden-/)
assert.match(source, /application\/pdf/)
assert.match(source, /spreadsheetml\.sheet/)
assert.doesNotMatch(source, /Plan Beginn.*Ist Beginn/s)

console.log('timesheet report source contract passed')
