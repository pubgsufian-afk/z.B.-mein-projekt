import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

globalThis.window = { addEventListener() {} }
const { reportPeriod } = await import('../public/reports-v2.js')

assert.deepEqual(reportPeriod('day', '2026-08-06'), { from: '2026-08-06', to: '2026-08-06' })
assert.deepEqual(reportPeriod('month', '2026-02'), { from: '2026-02-01', to: '2026-02-28' })
assert.deepEqual(reportPeriod('month', '2028-02'), { from: '2028-02-01', to: '2028-02-29' })
assert.deepEqual(reportPeriod('range', '', '2026-08-01', '2026-08-31'), { from: '2026-08-01', to: '2026-08-31' })
assert.throws(() => reportPeriod('range', '', '2026-08-31', '2026-08-01'), /ungültig/)

const backend = await readFile(new URL('../netlify/functions/reports-v2.mts', import.meta.url), 'utf8')
assert.match(backend, /Mitarbeiter dürfen keine PDF-Berichte herunterladen/)
assert.match(backend, /plannedStart|plannedEnd/)
assert.match(backend, /pauseMinutes/)
assert.match(backend, /netMinutes/)
assert.doesNotMatch(backend, /private address|Geburtsdatum|Steuer-ID|Personalnummer|Unterschrift/i)
assert.match(backend, /habun-logo\.png/)
assert.match(backend, /NO_DATA/)

console.log('Reports V2 tests passed · 12 assertions')
