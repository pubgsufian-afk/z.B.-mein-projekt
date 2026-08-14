import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../frontend/src/AdminOverview.jsx', import.meta.url), 'utf8')
const css = [
  readFileSync(new URL('../frontend/src/admin-overview.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../frontend/src/daily-report-management.css', import.meta.url), 'utf8'),
].join('\n')

for (const label of [
  'Tages-PDF herunterladen',
  'Bearbeiten',
  'Löschen',
  'Zuletzt bearbeitet',
  'Bericht wirklich endgültig löschen?',
]) {
  assert.match(source, new RegExp(label.replace(/[?]/g, '\\?')), `report manager must render ${label}`)
}
assert.match(source, /type="date"/, 'history must provide a date filter')
assert.match(source, /method:\s*'PATCH'/, 'edit must use PATCH')
assert.match(source, /method:\s*'DELETE'/, 'delete must use DELETE')
assert.match(source, /daily-reports-pdf/, 'UI must use daily report PDF endpoint')
assert.match(source, /credentials:\s*'same-origin'/, 'PDF download must keep authentication')
assert.match(source, /URL\.createObjectURL/, 'PDF response must be downloaded as a blob')
assert.match(source, /setDeletingReport/, 'first delete tap must enter confirmation state')
assert.match(source, /daily-report-management\.css/, 'management styles must be imported by AdminOverview')
assert.match(css, /daily-report-toolbar/, 'date/PDF toolbar needs responsive styling')
assert.match(css, /daily-report-entry-actions/, 'report actions need dedicated styling')
assert.match(css, /daily-report-delete-confirm/, 'permanent delete confirmation needs dedicated styling')

console.log('daily report management UI source contract: ok')
