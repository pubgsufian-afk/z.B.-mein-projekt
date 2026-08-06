import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const backend = await readFile(new URL('../netlify/functions/schedule-assist-v2.mts', import.meta.url), 'utf8')
const client = await readFile(new URL('../public/schedule-assist-v2.js', import.meta.url), 'utf8')
assert.match(backend, /save-template/)
assert.match(backend, /resource === 'suggestions'/)
assert.match(backend, /resource === 'review'/)
assert.match(backend, /conflicts/)
assert.match(client, /Vorlage anwenden/)
assert.match(client, /Verfügbare Mitarbeiter vorschlagen/)
assert.match(client, /Entwürfe:/)
assert.match(client, /Zeitliche Warnungen:/)

console.log('Schedule assistant tests passed · 8 assertions')
