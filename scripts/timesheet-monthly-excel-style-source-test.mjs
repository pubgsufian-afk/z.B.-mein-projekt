import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheet-monthly-reports.mts', 'utf8')

// Excel should keep the same Stundenzettel data, but present it as a polished office document.
assert.match(source, /mergeCells\('A1:H1'\)/)
assert.match(source, /mergeCells\('A2:H2'\)/)
assert.match(source, /freezePanes|views:\s*\[\{\s*state:\s*'frozen'/)
assert.match(source, /autoFilter/)
assert.match(source, /fitToPage/)
assert.match(source, /orientation:\s*'landscape'/)
assert.match(source, /FFDBA62B|DBA62B/)
assert.match(source, /FF151515|151515/)
assert.match(source, /alternat|F7F7F7|FFF7F7F7/i)
assert.match(source, /\[h\]:mm/)
assert.match(source, /SUM\(E/)
assert.match(source, /Gesamtstunden/)
assert.match(source, /Mitarbeiter/)
assert.match(source, /Zeitraum/)

// PDF stays in the established layout and is not redesigned by this change.
assert.match(source, /page\.drawText\('Stundenzettel'/)
assert.match(source, /Arbeitnehmer:/)
assert.match(source, /opacity:\s*0\.0[4-9]/)
assert.match(source, /Anmerkungen/)

console.log('professional monthly Excel style source contract passed')
