import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheet-monthly-reports.mts', 'utf8')
assert.match(source, /page\.drawText\('Stundenzettel'/)
assert.doesNotMatch(source, /Arbeitszeitenbericht/)
assert.match(source, /Arbeitnehmer:/)
assert.match(source, /Datum.*Startzeit.*Endzeit.*Pause.*Dauer.*Status.*Tätigkeit \/ Einsatzort/s)
assert.match(source, /Dienstplan/)
assert.match(source, /Manuell/)
assert.match(source, /Anmerkungen/)
assert.match(source, /opacity:\s*0\.0[4-9]/)
assert.match(source, /gold/i)
assert.doesNotMatch(source, /attendance_events|\/api\/attendance|Erfasst/)
console.log('timesheet monthly PDF layout source contract passed')
