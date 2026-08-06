import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const server = await readFile(new URL('../netlify/functions/_shared/daily-attendance-service.mts', import.meta.url), 'utf8')
const client = await readFile(new URL('../public/attendance-day-reset.js', import.meta.url), 'utf8')
assert.match(server, /eventDateInBerlin\(now\(\)\)/)
assert.match(server, /filter\(\(entry\).*entry\.eventDate/s)
assert.match(client, /Europe\/Berlin/)
assert.match(client, /phase: !last \? 'idle'/)
assert.match(client, /habun-attendance-state-v2/)

console.log('Attendance day scope tests passed · 5 assertions')
