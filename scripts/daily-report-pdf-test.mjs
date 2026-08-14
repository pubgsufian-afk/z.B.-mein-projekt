import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../netlify/functions/daily-reports-pdf.mts', import.meta.url), 'utf8')

for (const token of [
  'PDFDocument',
  'StandardFonts',
  'loadOriginalLogo',
  'drawCenteredShieldLogo',
  'Content-Disposition',
  'Tagesbericht',
  'Seite',
]) {
  assert.match(source, new RegExp(token), `daily report PDF must contain ${token}`)
}
assert.match(source, /application\/pdf/, 'endpoint must return a real PDF')
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/, 'PDF must be owner/admin only')
assert.match(source, /findDailyReportById/, 'individual PDF must resolve a public report id')
assert.match(source, /listDailyReports/, 'day PDF must use the same stored reports')
assert.match(source, /Europe\/Berlin|berlinDateKey/, 'PDF day semantics must use Berlin date logic')
assert.match(source, /Tagesbericht_/, 'individual filename must be deterministic')
assert.match(source, /Tagesberichte_/, 'day filename must be deterministic')

console.log('daily report PDF source contract: ok')
