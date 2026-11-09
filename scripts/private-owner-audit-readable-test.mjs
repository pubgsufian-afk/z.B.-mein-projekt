import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditChanges, auditValue, describeAuditEvent } from '../frontend/src/private-audit-presentation.mjs'

const event = {
  actorName: 'Sufian', action: 'Berechtigung geändert', category: 'Mitarbeiter',
  targetName: 'Testmitarbeiter', actorId: 'actor',
  entityId: 'target', before: { role: 'admin' }, after: { role: 'employee' },
}
const result = describeAuditEvent(event)
assert.equal(result.title, 'Sufian hat die Berechtigung von Testmitarbeiter geändert.')
assert.equal(result.changes.length, 1)
assert.deepEqual(result.changes[0], {
  key: 'role', label: 'Berechtigung',
  before: 'Administrator', after: 'Mitarbeiter', hasBefore: true, hasAfter: true,
})
assert.match(describeAuditEvent({ ...event, targetName: '' }).title, /eines Mitarbeiters/)
assert.doesNotMatch(describeAuditEvent({ ...event, targetName: '' }).title, /Testmitarbeiter/)

const schedule = describeAuditEvent({
  actorName: 'Admin A', targetName: 'Mitarbeiter B',
  category: 'Dienstplan', action: 'Dienst bearbeitet',
  before: { date: '2026-11-09', start: '07:00', end: '17:00', pauseMinutes: 60, employeeUserId: 'private' },
  after: { date: '2026-11-09', start: '08:00', end: '16:00', pauseMinutes: 30, employeeUserId: 'private' },
})
assert.match(schedule.title, /Mitarbeiter B/)
assert.equal(schedule.changes.length, 3)
assert.deepEqual(schedule.changes.map((x) => x.label), ['Dienstbeginn', 'Dienstende', 'Pause'])
assert.equal(auditValue('date', '2026-11-09'), '09.11.2026')
assert.equal(auditValue('role', 'owner'), 'Inhaber')
assert.equal(auditValue('pauseMinutes', 30), '30 Minuten')

const access = readFileSync('netlify/functions/private-owner-audit.mts', 'utf8')
const owner = readFileSync('netlify/functions/_shared/portal-private-audit-service.mts', 'utf8')
const jsx = readFileSync('frontend/src/PrivateOwnerAudit.jsx', 'utf8')
assert.match(access, /if \(!allowed\) return json\(\{ message: 'Keine Berechtigung\.' \}, 403\)/)
assert.match(access, /targetName: String\(event\.targetName/)
assert.match(access, /schedule_employees/)
assert.match(access, /'access\/' \+ id/)
assert.match(owner, /lock\.userId === actor\.userId/)
assert.match(jsx, /describeAuditEvent\(event\)/)
assert.match(jsx, /private-audit-change-row/)
assert.match(jsx, /Technische Angaben anzeigen/)
assert.doesNotMatch(jsx, /JSON\.stringify\(data, null, 2\)/)
console.log('PASS: readable account-specific audit summaries, target name lookup, before/after presentation, privacy')
