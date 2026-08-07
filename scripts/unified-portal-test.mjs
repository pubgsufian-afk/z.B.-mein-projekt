import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [index, app, styles, packageJson] = await Promise.all([
  readFile('public/index.html', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
  readFile('package.json', 'utf8'),
])

assert.match(index, /assets\/habun-portal\.js/)
assert.match(index, /assets\/habun-portal\.css/)
assert.doesNotMatch(index, /attendance-v2\.js|attendance-v2-compat\.js|Neue Zeiterfassung|Zeiterfassung und Planung/)
assert.equal((index.match(/id="root"/g) || []).length, 1)
assert.match(index, /habun-logo|apple-touch-icon|favicon/)

for (const label of ['Übersicht', 'Zeiterfassung', 'Mitarbeiter', 'Dienstplan', 'Stundenzettel', 'Einsatzorte', 'Berichte', 'Einstellungen']) {
  assert.match(app, new RegExp(label))
}
assert.doesNotMatch(app, /key: 'corrections', label:/)
assert.doesNotMatch(app, /key: 'times', label:/)
assert.match(app, /className="digital-clock"/)
assert.match(app, /Arbeit beginnen/)
assert.match(app, /Pause beginnen/)
assert.match(app, /Pause beenden/)
assert.match(app, /Arbeit beenden/)
assert.match(app, /PDF-Vorschau/)
assert.match(app, /PDF herunterladen/)
assert.match(app, /Excel herunterladen/)
assert.match(app, /company-settings/)
assert.doesNotMatch(app, /Mitarbeiter-ID|Personalnummer|Neue Zeiterfassung|role="dialog"/i)
assert.match(styles, /--gold:\s*#d8a936/)
assert.match(styles, /@media \(max-width: 390px\)/)
assert.match(styles, /overflow-x:\s*hidden/)
assert.match(styles, /week-cards/)
assert.match(app, /employee-kiosk-shell/)
assert.match(app, /employee-kiosk-nav/)
assert.match(app, /Mein Dienstplan/)
assert.match(app, /brand-mark/)
assert.match(styles, /safe-area-inset-top/)
assert.match(styles, /safe-area-inset-bottom/)
assert.match(packageJson, /"react"/)
assert.match(packageJson, /"build:frontend"/)

console.log('Unified portal source tests passed')