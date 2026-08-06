import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, legacySource] = await Promise.all([
  readFile('netlify/functions/unified-reports.mts', 'utf8'),
  readFile('netlify/functions/reports-v2.mts', 'utf8'),
])

for (const reportSource of [source, legacySource]) {
  assert.match(reportSource, /readCompanySettings/)
  assert.doesNotMatch(reportSource, /cardinality\(\$3::text\[\]\)/)
  assert.doesNotMatch(reportSource, /ANY\(\$3::text\[\]\)/)
  assert.match(reportSource, /buildEmployeeFilter/)
  assert.match(reportSource, /user_id IN \(/)
}

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

console.log('PDF, Excel and report query tests passed')
