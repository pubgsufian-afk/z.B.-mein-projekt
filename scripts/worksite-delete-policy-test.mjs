import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, scheduleNeon, app, attendance] = await Promise.all([
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-v2-neon.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('netlify/functions/attendance.mts', 'utf8'),
])

assert.match(schedule, /action === 'object-delete'/)
assert.match(schedule, /Nur die Administration darf Einsatzorte löschen/)
assert.match(schedule, /const key = `objects\/\$\{id\}`/)
assert.match(schedule, /store\(\)\.delete\(key\)/)
assert.doesNotMatch(schedule, /object-delete[\s\S]{0,1200}shifts\//)

assert.match(app, /function selectScheduleObject\(event\)/)
assert.match(app, /objectId,/)
assert.match(app, /location: object \? object\.name : ''/)
assert.match(app, /onChange=\{selectScheduleObject\}/)
assert.match(app, /Bezeichnung des Einsatzortes/)
assert.match(app, /Einsatzort löschen/)

assert.match(app, /Aktuellen Standort übernehmen/)
assert.match(app, /navigator\.geolocation\.getCurrentPosition/)
assert.match(app, /\/api\/worksite-v2/)
assert.match(app, /Standortzugriff[^\n]+nicht erlaubt/)

assert.match(scheduleNeon, /attendance_objects/)
assert.match(attendance, /portal-schedule-v2/)
assert.match(
  attendance,
  /scheduleStore\.get\((?:`objects\/\$\{objectId\}`|'objects\/'\s*\+\s*objectId)/,
  'Attendance muss den aktuellen Einsatzort über objects/<objectId> nachladen.',
)

console.log('Worksite delete, geolocation and attendance sync policy tests passed')
