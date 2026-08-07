import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const attendance = await readFile('netlify/functions/attendance.mts', 'utf8')
const app = await readFile('frontend/src/App.jsx', 'utf8')

assert.match(
  attendance,
  /const previous = bounded[\s\S]*?item\.bounds\.endStamp < current\.stamp[\s\S]*?return previous\?\.entry \|\| null/,
  'Wenn heute kein eigener Dienst vorhanden ist, soll die Zeiterfassung den letzten veröffentlichten eigenen Dienst nur zur Anzeige zurückgeben.',
)
assert.match(attendance, /scheduleIsToday:/, 'Die API muss kennzeichnen, ob der angezeigte Dienst zum heutigen Datum gehört.')
assert.match(app, /Letzter Dienst/, 'Die Zeiterfassung muss einen früheren Dienst als „Letzter Dienst“ kennzeichnen.')
assert.match(app, /Für dich ist heute kein Dienst eingetragen\./, 'Ohne heutigen Dienst darf nicht behauptet werden, der gesamte Dienstplan sei nicht freigegeben.')

console.log('Attendance last schedule display test passed')
