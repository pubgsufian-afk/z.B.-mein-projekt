import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile('frontend/src/App.jsx', 'utf8')
const berlinDateKey = source.match(/function berlinDateKey\(value = new Date\(\)\) \{[\s\S]*?\n\}/)?.[0]
const mondayOf = source.match(/function mondayOf\(value = new Date\(\)\) \{[\s\S]*?\n\}/)?.[0]

assert.ok(berlinDateKey, 'Die Berliner Datumsfunktion fehlt.')
assert.ok(mondayOf, 'Die Wochenberechnung fehlt.')

const context = vm.createContext({ Date, Intl })
const calculateMonday = new vm.Script(`${berlinDateKey}\n${mondayOf}\n(value) => mondayOf(value)`).runInContext(context)

assert.equal(
  calculateMonday(new Date('2026-08-08T00:38:00+02:00')),
  '2026-08-03',
  'Kurz nach Mitternacht muss die Woche weiterhin am Montag 03.08.2026 beginnen.',
)
assert.equal(
  calculateMonday(new Date('2026-08-07T23:35:00+02:00')),
  '2026-08-03',
  'Vor Mitternacht muss dieselbe Kalenderwoche ausgewählt bleiben.',
)
assert.equal(calculateMonday('2026-08-08'), '2026-08-03')

console.log('Schedule midnight week regression test passed')
