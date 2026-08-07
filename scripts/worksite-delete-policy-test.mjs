import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, app] = await Promise.all([
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
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

console.log('Worksite delete and autofill policy tests passed')
