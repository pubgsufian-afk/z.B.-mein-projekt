import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditChanges, describeAuditEvent } from '../frontend/src/private-audit-presentation.mjs'

function file(path) { return readFileSync(path, 'utf8') }
const service = file('netlify/functions/_shared/portal-private-audit-service.mts')
const api = file('netlify/functions/private-owner-audit.mts')
const app = file('frontend/src/App.jsx')
const page = file('frontend/src/PrivateOwnerAudit.jsx')
const proxy = file('netlify/functions/_shared/proxy.mts')
const schedule = file('netlify/functions/schedule-v2-neon.mts')
const reports = file('netlify/functions/daily-reports.mts')
const registrations = file('netlify/functions/registrations.mts')
const scheduleRepo = file('netlify/functions/_shared/schedule-neon-repository.mts')

assert.match(service, /PORTAL_PRIVATE_AUDIT_OWNER_EMAIL/)
assert.match(service, /actor\.role !== 'owner'/)
assert.match(service, /owner\/identity-lock/)
assert.match(service, /lock\.userId === actor\.userId/)
assert.match(service, /stored\?\.userId === actor\.userId/)
assert.doesNotMatch(service, /if\s*\(\s*actor\.role\s*===\s*'owner'\s*\)\s*return true/)
assert.match(service, /SECRET_KEY/)
assert.match(api, /if \(!allowed\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(api, /isPrivateAuditOwner/)
assert.match(api, /resource === 'access'/)
assert.match(api, /request\.method !== 'GET'/)
assert.match(api, /attendance_audit_log/)
assert.match(api, /schedule_audit_log/)
assert.match(api, /timesheet_audit_log/)
assert.match(api, /employee_document_access_audit/)
assert.match(app, /private-audit', label: 'Mein Änderungsverlauf', roles: \[\]/)
assert.match(app, /data\.allowed === true && data\.userId === \(session\.userId \|\| session\.id\)/)
assert.match(app, /item\.key === 'private-audit' \? privateAuditAccess/)
assert.match(app, /page === 'private-audit' && privateAuditAccess/)
assert.match(page, /\/api\/private-owner-audit/)
assert.match(page, /Vorher/)
assert.match(page, /Nachher/)
assert.match(page, /downloadCsv/)
assert.match(proxy, /response\.ok/)
assert.match(proxy, /recordPortalAdminChange/)
assert.match(schedule, /action: 'Dienst gelöscht'.*before:/)
assert.match(reports, /Tagesbericht gelöscht/)
assert.match(registrations, /Berechtigung geändert/)


assert.match(schedule, /details: \{ before: existing \? auditShiftSnapshot\(existing\) : null, after: auditShiftSnapshot\(shift\) \}/)
assert.match(schedule, /action: 'shift-deleted', shiftId: id, details: \{ before: auditShiftSnapshot\(existing\) \}/)
assert.match(schedule, /writeScheduleAuditBatch\(created\.map/)
assert.match(schedule, /action: 'shift-week-published'/)
assert.match(scheduleRepo, /export async function writeScheduleAuditBatch/)
assert.match(api, /event\.after\?\.employeeName \|\| event\.before\?\.employeeName/)
assert.match(page, /Betroffener Dienst:/)
assert.match(page, /Alle gespeicherten Vorher-\/Nachher-Werte/)

const before = {
  employeeUserId: 'test-user', employeeName: 'Aras Alyas',
  date: '2026-11-11', start: '06:00', end: '14:00', workArea: 'ZuKo',
  status: 'published',
}
const after = { ...before, end: '15:00', workArea: 'Brandwache' }
const entry = { actorName: 'Aras Alyas', category: 'Dienstplan', action: 'shift-updated', targetName: 'Aras Alyas', before, after }
assert.deepEqual(auditChanges(entry).map((change) => change.key).sort(), ['end', 'workArea'])
assert.match(describeAuditEvent(entry).title, /Aras Alyas hat einen Dienst geändert für Aras Alyas/)
const created = { actorName: 'Aras Alyas', category: 'Dienstplan', action: 'shift-copied', targetName: 'Aras Alyas', after }
assert.match(describeAuditEvent(created).title, /aus der Vorwoche übernommen/)

console.log('PASS: personal account ID gate, server authorization, audit sources and responsive owner UI')
