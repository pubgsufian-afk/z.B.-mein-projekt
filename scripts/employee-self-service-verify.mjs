import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import {
  validSelfServiceRange,
  mayManageEmployeeDocuments,
  mayDownloadEmployeeDocument,
  mayPublishToRecipient,
} from '../netlify/functions/_shared/employee-self-service-policy.mjs'

function source(name) { return readFileSync(new URL('../' + name, import.meta.url), 'utf8') }
const ownHours = source('netlify/functions/employee-timesheet.mts')
const postbox = source('netlify/functions/employee-documents.mts')
const reportService = source('netlify/functions/_shared/portal-admin-report-service.mts')
const app = source('frontend/src/App.jsx')
const ui = source('frontend/src/EmployeeSelfService.jsx')
const sql = source('netlify/database/migrations/20261106190000_employee_documents/migration.sql')

// Parse the new backend and frontend files using the same JS/TS transformer as the build.
for (const file of ['netlify/functions/employee-timesheet.mts', 'netlify/functions/employee-documents.mts',
  'frontend/src/EmployeeSelfService.jsx', 'frontend/src/App.jsx']) {
  transformSync(source(file), { loader: file.endsWith('.jsx') ? 'jsx' : 'ts', format: 'esm', target: 'es2022' })
}
console.log('PASS: JSX and TypeScript parser')

// Strict month/date and 370-day history window.
assert.deepEqual(validSelfServiceRange('2026-10-01', '2026-10-31'), { from: '2026-10-01', to: '2026-10-31' })
assert.deepEqual(validSelfServiceRange('2024-02-29', '2024-03-01'), { from: '2024-02-29', to: '2024-03-01' })
for (const [a, b] of [
  ['2026-02-29', '2026-03-01'], ['2026-02-31', '2026-03-01'],
  ['2026-11-02', '2026-11-01'], ['2025-01-01', '2026-12-31'],
  ['abc', '2026-11-01'], ['2026-10-01', '2026-13-01'],
]) assert.equal(validSelfServiceRange(a, b), null)
console.log('PASS: date validation and boundary dates')

// Authorization: staff, manager, unapproved users and wrong recipients are denied.
assert.equal(mayManageEmployeeDocuments('employee'), false)
assert.equal(mayManageEmployeeDocuments('manager'), false)
assert.equal(mayManageEmployeeDocuments('admin'), true)
assert.equal(mayManageEmployeeDocuments('owner'), true)
const doc = { employee_user_id: 'employee-1', revoked_at: null }
assert.equal(mayDownloadEmployeeDocument({ userId: 'employee-1', role: 'employee' }, doc), true)
assert.equal(mayDownloadEmployeeDocument({ userId: 'employee-2', role: 'employee' }, doc), false)
assert.equal(mayDownloadEmployeeDocument({ userId: 'employee-2', role: 'manager' }, doc), false)
assert.equal(mayDownloadEmployeeDocument({ userId: 'admin-1', role: 'admin' }, doc), true)
assert.equal(mayDownloadEmployeeDocument({ userId: 'employee-1', role: 'employee' }, { ...doc, revoked_at: '2026-11-06' }), false)
assert.equal(mayDownloadEmployeeDocument(null, doc), false)
assert.equal(mayPublishToRecipient('admin', { role: 'employee', status: 'active' }), true)
assert.equal(mayPublishToRecipient('admin', { role: 'employee', status: 'inactive' }), false)
assert.equal(mayPublishToRecipient('employee', { role: 'employee', status: 'active' }), false)
assert.equal(mayPublishToRecipient('admin', { role: 'pending', status: 'active' }), false)
console.log('PASS: multi-user document isolation and role checks')

// Source contracts ensure the identity is forced by server, not submitted by clients.
assert.match(ownHours, /userId\s*=\s*access\.current\.userId/)
assert.match(ownHours, /userIds:\s*\[userId\]/)
assert.match(ownHours, /listTimesheetEntries\(\{ from: range\.from, to: range\.to, employeeUserId: userId \}\)/)
assert.match(ownHours, /monthlyPdf\(request, rows, range\.from, range\.to\)/)
assert.match(ownHours, /monthlyXlsx\(rows, range\.from, range\.to\)/)
assert.match(ownHours, /syncPublishedScheduleRange\(range\.from, range\.to, userId, new Date\(\)\)/)
assert.doesNotMatch(ownHours, /searchParams\.get\(['"]userId['"]\)/)
assert.doesNotMatch(ownHours, /body\.userIds/)
assert.match(ownHours, /verifyRequestOrigin\(request\)/)
assert.match(reportService, /listEmployeeTimesheetRows/)
assert.match(reportService, /source: 'actual'/)
assert.match(reportService, /source: 'planned'/)
assert.match(postbox, /mayDownloadEmployeeDocument\(actor, row\)/)
assert.match(postbox, /mayPublishToRecipient\(actor\.role, recipient\)/)
assert.match(postbox, /verifyRequestOrigin\(request\)/)
assert.match(postbox, /region: 'eu-central-1'/)
assert.match(postbox, /createHash\('sha256'\)/)
assert.match(postbox, /'Cache-Control': 'private, no-store'/)
assert.match(postbox, /MAX_BYTES = 4 \* 1024 \* 1024/)
assert.match(postbox, /revoked_at IS NULL/)
assert.match(sql, /CREATE TABLE employee_documents/)
assert.match(sql, /employee_user_id text NOT NULL/)
assert.match(sql, /CREATE TABLE employee_document_access_audit/)
assert.match(sql, /revoked_at timestamp with time zone/)
console.log('PASS: authenticated scope, integrity, CSRF, privacy, withdrawal')

// Correct employee routes and admin surface, and no confidential PDF public links.
assert.match(app, /EmployeeTimesheetPage/)
assert.match(app, /EmployeeMailboxPage/)
assert.match(app, /'my-hours'/)
assert.match(app, /'mailbox'/)
assert.match(ui, /Erfasste Zeiten stammen aus der Stempeluhr/)
assert.match(ui, /Stundenzettel PDF/)
assert.match(ui, /Stundenzettel der Verwaltung/)
assert.match(ui, /Korrigiert \/ manuell/)
assert.match(ui, /Excel herunterladen/)
assert.match(ui, /Dokument zustellen/)
assert.match(ui, /Zurückziehen/)
assert.doesNotMatch(ui, /<a[^>]+href=["']https?:/)
console.log('PASS: employee and admin UI integration')
