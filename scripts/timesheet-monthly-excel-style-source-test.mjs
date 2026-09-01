import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheet-monthly-reports.mts', 'utf8')

assert.match(source, /Arbeitszeitenbericht/)
assert.match(source, /Arbeitnehmer:/)
assert.match(source, /Gesamtdauer/)
assert.match(source, /Platz für weitere Anmerkungen/)
assert.match(source, /colors\.green/)
assert.match(source, /colors\.orange/)
assert.match(source, /isWeekend\(item\.date\)/)
assert.match(source, /Math\.min\(205 \/ logo\.width, 170 \/ logo\.height\)/)
assert.match(source, /opacity:\s*0\.06/)
assert.match(source, /orientation: 'portrait'/)
assert.match(source, /rowsWithBlankDates\(employeeRows, from, to\)/)
assert.match(source, /Arbeitsstunden/)
assert.match(source, /pauseDisplay/)
assert.doesNotMatch(source, /Tätigkeit \/ Einsatzort/)
assert.match(source, /workbook\.addImage/)
assert.match(source, /sheet\.addImage/)
assert.doesNotMatch(source, /sheet\.getCell\('A1'\)\.value = 'Stundenzettel'/)
assert.doesNotMatch(source, /opacity:\s*1/)

console.log('Arbeitszeitenbericht reference-style contract passed')
