import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../public/live-attendance.js', import.meta.url), 'utf8')
assert.match(source, /owner.*admin.*manager/)
assert.match(source, /resource: 'live'/)
assert.match(source, /data-live-date/)
assert.match(source, /data-live-object/)
assert.match(source, /data-live-user/)
assert.match(source, /data-live-status/)
assert.match(source, /openstreetmap\.org/)
assert.match(source, /offlineCaptured/)
assert.doesNotMatch(source, /watchPosition|setInterval\([^)]*geolocation/)

console.log('Live attendance tests passed · 9 assertions')
