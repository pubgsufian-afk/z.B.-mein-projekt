import assert from 'node:assert/strict'
import fs from 'node:fs'

const urlFor = (path) => new URL(`../${path}`, import.meta.url)
const read = (path) => fs.readFileSync(urlFor(path), 'utf8')
const neon = read('netlify/functions/_shared/neon-attendance.mts')
const reportDatabase = read('netlify/functions/_shared/report-database.mts')
const fixedReport = read('netlify/functions/unified-reports-fixed.mts')
const main = read('frontend/src/main.jsx')
const editorPath = urlFor('frontend/src/admin-time-editing.js')
const endpointPath = urlFor('netlify/functions/attendance-time-edit.mts')
const service = read('netlify/functions/_shared/attendance-admin-service.mts')

function expectIncludes(source, marker, message) {
  assert.ok(source.includes(marker), message)
}

expectIncludes(neon, 'pauseMinutesAdjustment', 'history must expose the effective pause adjustment')
expectIncludes(neon, 'attendance_adjustments', 'history must read attendance adjustments')
expectIncludes(neon, 'pause_minutes_adjustment', 'history query must select the latest pause adjustment')

assert.ok(fs.existsSync(endpointPath), 'protected management time edit endpoint must exist')
const endpoint = read('netlify/functions/attendance-time-edit.mts')
expectIncludes(endpoint, "const DIRECT_TIME_EDIT_ROLES = new Set(['owner', 'admin', 'manager'])", 'direct editing must allow Hauptadmin, Admin and Einsatzleiter')
expectIncludes(endpoint, 'DIRECT_TIME_EDIT_ROLES.has(current.role)', 'server must enforce the three direct-edit roles')
expectIncludes(endpoint, 'verifyRequestOrigin', 'direct time edits must verify request origin')
expectIncludes(endpoint, 'attendance-admin-service.mts', 'browser time edit must use shared attendance service')
expectIncludes(endpoint, 'attendanceAdminService().updateSession', 'browser time edit must delegate shared mutation rules')
expectIncludes(endpoint, "path: '/api/attendance-time-edit'", 'management time edit endpoint must have a dedicated protected route')

for (const marker of [
  'attendance_adjustments',
  "'admin-time-edit'",
  'management-clock-out:',
  'Bei einem laufenden Dienst kann die Pause erst zusammen mit einem Arbeitsende korrigiert werden.',
  'Die Pause darf nicht länger als die Arbeitszeit sein.',
  'Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.',
  'Die neue Arbeitszeit darf bestehende Pausenbuchungen nicht ausschließen.',
  'attendance_legal_holds',
]) expectIncludes(service, marker, `shared time edit rule missing: ${marker}`)

expectIncludes(reportDatabase, 'pause_minutes_adjustment', 'production report query must load the effective pause adjustment')
expectIncludes(reportDatabase, 'attendance_adjustments', 'production report query must read attendance adjustments')
expectIncludes(fixedReport, 'pause_minutes_adjustment', 'production PDF/Excel rows must apply the effective pause adjustment')

assert.ok(fs.existsSync(editorPath), 'the isolated admin time editor module must exist')
const editor = read('frontend/src/admin-time-editing.js')
expectIncludes(main, "import { installAdminTimeEditing } from './admin-time-editing.js'", 'portal entrypoint must load the admin time editor')
expectIncludes(main, 'installAdminTimeEditing()', 'portal entrypoint must install the admin time editor')
expectIncludes(editor, "const TIME_EDIT_ROLES = new Set(['owner', 'admin', 'manager'])", 'edit UI must allow Hauptadmin, Admin and Einsatzleiter')
expectIncludes(editor, 'clockInEventId', 'session builder must keep the clock-in event id')
expectIncludes(editor, 'clockOutEventId', 'session builder must keep the clock-out event id')
expectIncludes(editor, 'pauseMinutesAdjustment', 'session builder must apply the effective pause adjustment')
expectIncludes(editor, 'for (const current of openByUser.values())', 'session builder must retain currently open checked-in sessions')
expectIncludes(editor, 'applyAdjustedValues', 'corrected pause/net values must be applied to rendered time cards and summary totals')
expectIncludes(editor, 'const canEdit = TIME_EDIT_ROLES.has(role)', 'all three management roles must get direct edit controls')
expectIncludes(editor, 'const openSession = !session.clockOutEventId', 'editor must distinguish an open checked-in session')
expectIncludes(editor, "button.textContent = 'Bearbeiten'", 'time cards must expose an edit action to authorized roles')
expectIncludes(editor, "clockOutAt: clockOutAt ? clockOutAt.toISOString() : null", 'open sessions must be savable without inventing an end time')
expectIncludes(editor, "fetch('/api/attendance-time-edit'", 'time editor must save through the protected management time endpoint')

console.log('admin-time-editing-test: PASS')
