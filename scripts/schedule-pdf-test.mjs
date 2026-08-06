import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source = await readFile('netlify/functions/schedule-pdf.mts', 'utf8')
assert.match(source, /const MANAGEMENT = new Set<Role>\(\['owner', 'admin', 'manager'\]\)/)
assert.match(source, /if \(!MANAGEMENT\.has\(current\.role\)\)/)
assert.match(source, /entry\.status === 'published'/)
assert.match(source, /readCompanySettings/)
assert.match(source, /application\/pdf/)
assert.match(source, /NO_SCHEDULE_DATA/)
assert.match(source, /Habun-Dienstplan-/)
assert.match(source, /X-Content-Type-Options/)
console.log('Schedule PDF tests passed')
