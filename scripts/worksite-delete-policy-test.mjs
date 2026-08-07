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
assert.match(app, /Einsatzort löschen/)
assert.match(app, /Bezeichnung des Einsatzortes/)

console.log('Worksite delete and autofill policy tests passed')
