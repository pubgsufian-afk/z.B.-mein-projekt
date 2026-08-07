import assert from 'node:assert/strict'
import fs from 'node:fs'

const urlFor = (path) => new URL(`../${path}`, import.meta.url)
const read = (path) => fs.readFileSync(urlFor(path), 'utf8')
const neon = read('netlify/functions/_shared/neon-attendance.mts')
const maintenance = read('netlify/functions/attendance-maintenance.mts')
const reportDatabase = read('netlify/functions/_shared/report-database.mts')
const fixedReport = read('netlify/functions/unified-reports-fixed.mts')
const main = read('frontend/src/main.jsx')
const editorPath = urlFor('frontend/src/admin-time-editing.js')

function expectIncludes(source, marker, message) {
  assert.ok(source.includes(marker), message)
}

expectIncludes(neon, 'pauseMinutesAdjustment', 'history must expose the effective pause adjustment')
expectIncludes(neon, 'attendance_adjustments', 'history must read attendance adjustments')
expectIncludes(neon, 'pause_minutes_adjustment', 'history query must select the latest pause adjustment')

expectIncludes(maintenance, "const ADMINISTRATION = new Set<Role>(['owner', 'admin'])", 'direct editing must have an owner/admin-only role guard')
expectIncludes(maintenance, "action === 'admin-time-edit'", 'maintenance endpoint must route admin-time-edit')
expectIncludes(maintenance, 'ADMINISTRATION.has(current.role)', 'server must enforce owner/admin direct-edit permission')
expectIncludes(maintenance, 'attendance_adjustments', 'direct edit must persist an effective pause adjustment')
expectIncludes(maintenance, "'admin-time-edit'", 'direct edit must be written to the audit log')
expectIncludes(maintenance, 'Die Pause darf nicht länger als die Arbeitszeit sein.', 'server must reject pause longer than gross work time')
expectIncludes(maintenance, 'Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.', 'server must reject end before start')
expectIncludes(maintenance, 'Der gespeicherte Arbeitsbeginn liegt nach dem Arbeitsende.', 'server must reject an invalid original event pair')
expectIncludes(maintenance, 'Die neue Arbeitszeit darf bestehende Pausenbuchungen nicht ausschließen.', 'server must keep existing break events inside edited session boundaries')

expectIncludes(reportDatabase, 'pause_minutes_adjustment', 'production report query must load the effective pause adjustment')
expectIncludes(reportDatabase, 'attendance_adjustments', 'production report query must read attendance adjustments')
expectIncludes(fixedReport, 'pause_minutes_adjustment', 'production PDF/Excel rows must apply the effective pause adjustment')

assert.ok(fs.existsSync(editorPath), 'the isolated admin time editor module must exist')
const editor = read('frontend/src/admin-time-editing.js')
expectIncludes(main, "import { installAdminTimeEditing } from './admin-time-editing.js'", 'portal entrypoint must load the admin time editor')
expectIncludes(main, 'installAdminTimeEditing()', 'portal entrypoint must install the admin time editor')
expectIncludes(editor, "const ADMIN_ROLES = new Set(['owner', 'admin'])", 'edit UI must be limited to owner/admin')
expectIncludes(editor, 'clockInEventId', 'session builder must keep the clock-in event id')
expectIncludes(editor, 'clockOutEventId', 'session builder must keep the clock-out event id')
expectIncludes(editor, 'pauseMinutesAdjustment', 'session builder must apply the effective pause adjustment')
expectIncludes(editor, 'applyAdjustedValues', 'corrected pause/net values must be applied to rendered time cards and summary totals')
expectIncludes(editor, 'const canEdit = ADMIN_ROLES.has(role)', 'owner/admin edit permission must be separated from read-only management display')
expectIncludes(editor, 'if (!canEdit) return', 'manager must remain read-only after corrected totals are applied')
expectIncludes(editor, "button.textContent = 'Bearbeiten'", 'completed time cards must expose an edit action to owner/admin')
expectIncludes(editor, "action: 'admin-time-edit'", 'time editor must call the privileged maintenance action')
expectIncludes(editor, "fetch('/api/attendance-maintenance'", 'time editor must save through the maintenance endpoint')

console.log('admin-time-editing-test: PASS')
