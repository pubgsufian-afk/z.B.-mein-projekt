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
const large = source('netlify/functions/employee-documents-large.mts')
const expandedSql = source('netlify/database/migrations/20261107010000_employee_documents_max_50mb/migration.sql')
const reportService = source('netlify/functions/_shared/portal-admin-report-service.mts')
const app = source('frontend/src/App.jsx')
const ui = source('frontend/src/EmployeeSelfService.jsx')
const sql = source('netlify/database/migrations/20261106190000_employee_documents/migration.sql')

// Parse the new backend and frontend files using the same JS/TS transformer as the build.
for (const file of ['netlify/functions/employee-timesheet.mts', 'netlify/functions/employee-documents.mts', 'netlify/functions/employee-documents-large.mts',
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
assert.doesNotMatch(ownHours, /syncPublishedScheduleRange/, 'Employee read endpoints must not mutate all workers timesheets')
assert.doesNotMatch(ownHours, /searchParams\.get\(['"]userId['"]\)/)
assert.doesNotMatch(ownHours, /body\.userIds/)
assert.match(ownHours, /verifyRequestOrigin\(request\)/)
assert.match(reportService, /listEmployeeTimesheetRows/)
assert.match(reportService, /source: 'actual'/)
assert.match(reportService, /source: 'planned'/)
assert.match(postbox, /mayDownloadEmployeeDocument\(actor, row\)/)
assert.match(postbox, /mayPublishToRecipient\(actor\.role, recipient\)/)
assert.match(postbox, /senderNamesFor\(/, 'Mailbox sender must be derived by server')
assert.match(postbox, /get\('access\/\s*' \+ id/, 'Mailbox sender must come from access records')
assert.match(postbox, /sender_user_id/, 'Mailbox sender must use immutable database author ID')
assert.match(postbox, /Absender nicht zugeordnet/, 'Unknown senders must have an honest fallback')
assert.match(ui, /Gesendet von: \{doc\.senderName/, 'Employee and admin cards must show verified sender')

assert.match(postbox, /documentType === 'contract' \? 'Arbeitsvertrag'/)
assert.match(postbox, /documentType === 'payslip' \? 'Lohnabrechnung'/)
assert.match(postbox, /sendPushToUsers\(\{[\s\S]*?userIds: \[employeeUserId\]/, 'postbox push must target exactly the selected employee')
assert.match(postbox, /body: 'Du hast ein neues Dokument in deinem Postfach\.'/)
assert.match(ui, /\{type === 'other' && <label>Bezeichnung/, 'only other documents need a custom title')
assert.match(ui, /\(type === 'other' && !title\.trim\(\)\)/, 'standard documents must upload without a custom title')
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
assert.match(ui, /MAX_DOCUMENT_BYTES = 50 \* 1024 \* 1024/, 'Upload must reject files larger than 50 MB before sending')
assert.match(ui, /documentFileError\(file\)/, 'Upload submission must revalidate the selected PDF')
assert.match(ui, /uploadLargeEmployeeDocument/, 'iPhone must split large files before upload')
assert.match(ui, /downloadLargeEmployeeDocument/, 'iPhone must reconstruct large private PDFs')
assert.match(large, /CHUNK_BYTES = 2 \* 1024 \* 1024/)
assert.match(large, /MAX_BYTES = 50 \* 1024 \* 1024/)
assert.match(large, /verifyRequestOrigin\(request\)/, 'New write endpoint must check origin')
assert.match(large, /mayDownloadEmployeeDocument\(actor, row\)/, 'New download endpoint must check ownership on every chunk')
assert.match(large, /session.senderUserId|info.senderUserId/, 'Upload session must bind to actual admin')
assert.match(large, /sendPushToUsers\(\{[\s\S]*?userIds: \[session.employeeUserId\]/)
assert.match(expandedSql, /52428800/, 'Postgres size check must allow full 50 MB')
assert.match(expandedSql, /DROP CONSTRAINT employee_documents_byte_size_check/, 'Old database limit must be removed safely')
assert.match(ui, /response\.status === 413/, 'Oversized Netlify responses must have actionable errors')
assert.match(ui, /Dateigröße:/, 'Show PDF size before uploading')

assert.match(ui, /Zurückziehen/)
assert.doesNotMatch(ui, /<a[^>]+href=["']https?:/)
console.log('PASS: employee and admin UI integration')


// Daily report policy: employees and managers may submit, but no submitted report
// can ever be read by staff, including their own. Admins alone can read or manage.
const { canSubmitDailyReport, canManageDailyReport, mayReadDailyReport } = await import('../netlify/functions/_shared/daily-report-policy.mjs')
for (const role of ['owner', 'admin', 'manager', 'employee']) assert.equal(canSubmitDailyReport(role), true)
for (const role of ['pending', 'anonymous', '']) assert.equal(canSubmitDailyReport(role), false)
for (const role of ['employee', 'manager', 'pending']) assert.equal(canManageDailyReport(role), false)
for (const role of ['owner', 'admin']) assert.equal(canManageDailyReport(role), true)
const ownDaily = { id: 'report-1', authorId: 'employee-one', text: 'Testbericht', createdAt: '2026-11-06T10:00:00Z' }
assert.equal(mayReadDailyReport({ userId: 'employee-one', role: 'employee' }, ownDaily), false)
assert.equal(mayReadDailyReport({ userId: 'employee-two', role: 'employee' }, ownDaily), false)
assert.equal(mayReadDailyReport({ userId: 'employee-two', role: 'manager' }, ownDaily), false)
assert.equal(mayReadDailyReport({ userId: 'administrator', role: 'admin' }, ownDaily), true)
assert.equal(mayReadDailyReport({ userId: 'owner', role: 'owner' }, ownDaily), true)
assert.equal(mayReadDailyReport({ userId: 'employee-one', role: 'pending' }, ownDaily), false)
assert.equal(mayReadDailyReport(null, ownDaily), false)
const daily = source('netlify/functions/daily-reports.mts')
const dailyPdf = source('netlify/functions/daily-reports-pdf.mts')
const dailyUi = source('frontend/src/EmployeeDailyReports.jsx')
const dailyCss = source('frontend/src/employee-daily-reports.css')
transformSync(daily, { loader: 'ts', format: 'esm', target: 'es2022' })
transformSync(dailyPdf, { loader: 'ts', format: 'esm', target: 'es2022' })
transformSync(dailyUi, { loader: 'jsx', format: 'esm', target: 'es2022' })
assert.match(daily, /requirePortalRole\(\['owner', 'admin', 'manager', 'employee'\]\)/)
assert.match(daily, /if \(request.method === 'GET'\) \{\s*if \(!canManageDailyReport\(current\.role\)\)/)
assert.match(daily, /\.filter\(\(report\) => mayReadDailyReport\(current, report\)\)/)
assert.match(daily, /authorId: current\.userId/)
assert.match(daily, /if \(!canManageDailyReport\(current\.role\)\)/)
assert.match(daily, /verifyRequestOrigin\(request\)/)
assert.match(dailyPdf, /mayReadDailyReport\(access\.current, found\.report\)/)
assert.match(dailyPdf, /if \(!canManageDailyReport\(access\.current\.role\)\)/)
assert.match(app, /EmployeeDailyReports/)
assert.match(app, /'daily-reports'/)
assert.match(dailyUi, /Tagesbericht melden/)
assert.match(dailyUi, /Bericht verbindlich absenden/)
assert.match(dailyUi, /Nach dem Absenden können nur Administratoren/)
assert.doesNotMatch(dailyUi, /Meine gesendeten Berichte|downloadOwnPdf|\/api\/daily-reports\?date=/)
assert.doesNotMatch(dailyUi, /\/api\/daily-reports-pdf/)
assert.doesNotMatch(dailyUi, /method:\s*['"](?:PATCH|DELETE)['"]/)
assert.doesNotMatch(dailyUi, /Löschen|Änderungen speichern|Bericht bearbeiten/)
assert.match(dailyCss, /max-width:\s*620px/)
console.log('PASS: staff daily reports are submit-only and admin-only after submission')
