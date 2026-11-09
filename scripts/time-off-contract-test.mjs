import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { schedulableEmployees, employeeOnDayOff } from '../frontend/src/time-off-policy.mjs'

const staff = [
  { userId: 'user-1', fullName: 'Mitarbeiter A' },
  { userId: 'user-2', fullName: 'Mitarbeiter B' },
]
const absences = [{ date: '2026-11-16', employeeUserId: 'user-1', source: 'request' }]
assert.equal(employeeOnDayOff(absences, 'user-1', '2026-11-16'), true)
assert.equal(employeeOnDayOff(absences, 'user-1', '2026-11-17'), false)
assert.equal(employeeOnDayOff(absences, 'user-2', '2026-11-16'), false)
assert.deepEqual(schedulableEmployees(staff, absences, '2026-11-16').map((person) => person.userId), ['user-2'])
assert.deepEqual(schedulableEmployees(staff, absences, '2026-11-17').map((person) => person.userId), ['user-1', 'user-2'])
assert.equal(schedulableEmployees(staff, [], '2026-11-16').length, 2)

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const migration = read('netlify/database/migrations/20261109234000_time_off_management/migration.sql')
const api = read('netlify/functions/time-off.mts')
const schedule = read('netlify/functions/schedule-v2-neon.mts')
const planner = read('frontend/src/App.jsx')
const ui = read('frontend/src/TimeOffPage.jsx')
const pdf = read('netlify/functions/schedule-pdf-fixed.mts')
for (const name of ['schedule_time_off_requests', 'schedule_days_off']) assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS ' + name))
assert.match(migration, /BEFORE INSERT OR UPDATE OF employee_user_id, shift_date ON schedule_shifts/)
assert.match(migration, /BEFORE INSERT OR UPDATE OF employee_user_id, day_off_date ON schedule_days_off/)
assert.ok(migration.includes('pg_advisory_xact_lock'), 'the two opposite writes must share advisory locks')
assert.match(migration, /HABUN_DAY_OFF_CONFLICT/)
assert.match(migration, /HABUN_SHIFT_CONFLICT/)
assert.match(api, /currentPortalActor/)
assert.match(api, /verifyRequestOrigin/)
assert.match(api, /actor\.userId/)
assert.match(api, /MANAGERS\.has/)
for (const action of ['request', 'decide', 'set-day-off', 'remove-day-off', 'withdraw']) assert.ok(api.includes("case '" + action + "'"))
assert.match(api, /FOR UPDATE/, 'approval must lock a pending request')
assert.match(api, /WHERE id=\$1 AND employee_user_id=\$2 AND status='pending'/, 'withdrawal must only affect the author')
assert.match(api, /has_shift/, 'admin review should show already-booked dates')
assert.match(schedule, /DAY_OFF_CONFLICT/)
assert.match(planner, /schedulableEmployees\(employees, daysOff, form\.date\)/)
assert.match(planner, /action: 'set-day-off'/)
assert.match(planner, /employee-shift-time">Dienstfrei/)
assert.match(planner, /page === 'time-off'/)
assert.match(ui, /Freiwunsch senden/)
assert.match(ui, /Genehmigen/)
assert.match(ui, /Ablehnen/)
assert.match(pdf, /offPayload\.daysOff/)
assert.match(pdf, /workArea: 'Dienstfrei'/)
console.log('PASS time-off policy and cross-layer safety contract tests')
