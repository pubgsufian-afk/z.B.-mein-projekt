import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, attendanceService, app] = await Promise.all([
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/_shared/attendance-service.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])

// Dienstplanung: Nur gespeicherte Einsatzorte sind zulässig.
assert.match(schedule, /Einsatzort muss aus den gespeicherten Einsatzorten ausgewählt werden/)
assert.match(schedule, /findWorkSite\(String\(body\.objectId/)
assert.match(schedule, /Einsatzort benötigt gültige Koordinaten für die Standortprüfung/)

// Oberfläche: gespeicherter Einsatzort ist Pflicht, Name wird automatisch gezeigt.
assert.match(app, /function selectScheduleObject\(event\)/)
assert.match(app, /<select value=\{form\.objectId\} onChange=\{selectScheduleObject\} required>/)
assert.doesNotMatch(app, /Ohne gespeicherten Einsatzort/)
assert.match(app, /Bezeichnung des Einsatzortes<input value=\{form\.location\} readOnly/)
assert.match(app, /location: object\?\.name \|\| ''/)

// Zeiterfassung: Arbeitsbeginn wird serverseitig nur innerhalb des zugewiesenen Bereichs akzeptiert.
assert.match(attendanceService, /CHECK_IN_WORKSITE_REQUIRED/)
assert.match(attendanceService, /CHECK_IN_LOCATION_REQUIRED/)
assert.match(attendanceService, /CHECK_IN_OUTSIDE_WORKSITE/)
assert.match(attendanceService, /payload\.action === 'clock-in'/)
assert.match(attendanceService, /classification\.status !== 'inside'/)

console.log('Strict worksite schedule and check-in policy tests passed')
