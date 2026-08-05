import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const backend = await readFile(new URL('../netlify/functions/worksite-v2.mts', import.meta.url), 'utf8')
assert.match(backend, /Nur die Administration darf Einsatzort-Koordinaten ändern/)
assert.match(backend, /radiusMeters/)
assert.match(backend, /attendance_objects/)
assert.match(backend, /ON CONFLICT \(id\) DO UPDATE/)
assert.match(backend, /ATTENDANCE_DATABASE_URL/)
assert.doesNotMatch(backend, /const\s+[^=]*(password|secret|token)\s*=\s*['"][^'"]+/i)

console.log('Worksite V2 tests passed · 6 assertions')
