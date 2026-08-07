import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const neon = read('netlify/functions/_shared/neon-attendance.mts')
const maintenance = read('netlify/functions/attendance-maintenance.mts')
const app = read('frontend/src/App.jsx')

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

expectIncludes(app, 'clockInEventId', 'session builder must keep the clock-in event id')
expectIncludes(app, 'clockOutEventId', 'session builder must keep the clock-out event id')
expectIncludes(app, 'pauseMinutesAdjustment', 'session builder must apply the effective pause adjustment')
expectIncludes(app, 'ADMINISTRATION.has(session.role)', 'edit UI must be limited to owner/admin')
expectIncludes(app, '>Bearbeiten</button>', 'completed time cards must expose an edit action to owner/admin')
expectIncludes(app, "action: 'admin-time-edit'", 'time editor must call the privileged maintenance action')
expectIncludes(app, "apiJson('/api/attendance-maintenance'", 'time editor must save through the maintenance endpoint')

assert.ok(!/ADMINISTRATION\.has\(session\.role\)[\s\S]{0,400}Einsatzleiter/.test(app), 'manager must not receive the direct edit control')

console.log('admin-time-editing-test: PASS')
