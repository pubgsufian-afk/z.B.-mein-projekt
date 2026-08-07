import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')

const scheduleStart = app.indexOf('function SchedulePage({ session }) {')
const scheduleEnd = app.indexOf('\nfunction TimesPage', scheduleStart)
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'SchedulePage wurde nicht gefunden.')
const schedule = app.slice(scheduleStart, scheduleEnd)

assert.match(schedule, /const \[pdfFrom, setPdfFrom\] = useState\(week\)/, 'PDF-Von-Zustand fehlt.')
assert.match(schedule, /const \[pdfTo, setPdfTo\] = useState\(addDays\(week, 6\)\)/, 'PDF-Bis-Zustand fehlt.')
assert.match(schedule, /aria-label="Dienstplan PDF von"/, 'Von-Datumsfeld fehlt.')
assert.match(schedule, /aria-label="Dienstplan PDF bis"/, 'Bis-Datumsfeld fehlt.')
assert.match(schedule, /body: JSON\.stringify\(\{ from: pdfFrom, to: pdfTo \}\)/, 'PDF-Download verwendet nicht den gewählten Zeitraum.')
assert.match(schedule, /if \(pdfTo < pdfFrom\)/, 'Ungültiger Zeitraum wird nicht abgefangen.')
assert.match(schedule, /Das Bis-Datum darf nicht vor dem Von-Datum liegen\./, 'Fehlermeldung für ungültigen Zeitraum fehlt.')
assert.match(schedule, /MANAGEMENT\.has\(session\.role\) && <div className="schedule-pdf-range">/, 'PDF-Zeitraum ist nicht auf Managementrollen begrenzt.')

console.log('Schedule PDF range UI policy tests passed')
