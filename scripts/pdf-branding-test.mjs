import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/unified-reports.mts', 'utf8')
assert.match(source, /readCompanySettings/)
assert.match(source, /settings\.logoUrl/)
assert.match(source, /settings\.companyName/)
assert.match(source, /settings\.phone/)
assert.match(source, /settings\.email/)
assert.match(source, /embedPng|embedJpg/)
assert.match(source, /application\/pdf/)
assert.match(source, /spreadsheetml/)
assert.match(source, /Arbeitszeiten/)
assert.match(source, /Summen/)
assert.doesNotMatch(source, /Personalnummer|Mitarbeiter-ID|Unterschrift/i)

console.log('PDF and Excel branding tests passed')
