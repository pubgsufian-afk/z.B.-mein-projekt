import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  normalizeHistoryInspection,
  portalHistoryResultTooLarge,
} from '../netlify/functions/_shared/portal-admin-history.mts'

assert.deepEqual(normalizeHistoryInspection({
  employeeUserId: 'u1',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
}), {
  employeeUserId: 'u1',
  employeeName: '',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
})
assert.deepEqual(normalizeHistoryInspection({
  employeeName: '  Kwame Akakpo  ',
  from: '2026-08-01',
  to: '2026-08-24',
}), {
  employeeUserId: '',
  employeeName: 'Kwame Akakpo',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
})
assert.throws(() => normalizeHistoryInspection({ from: '2026-08-01', to: '2026-08-24' }), /Mitarbeiter/)
assert.throws(() => normalizeHistoryInspection({ employeeUserId: 'u1', from: '2026-08-24', to: '2026-08-01' }), /Zeitraum/)
assert.equal(portalHistoryResultTooLarge({ rows: ['x'] }), false)
assert.equal(portalHistoryResultTooLarge({ rows: ['x'.repeat(390000)] }), true)

const repository = await readFile('netlify/functions/_shared/portal-admin-history-repository.mts', 'utf8')
assert.match(repository, /listLegacyTimesheetEntries/)
assert.match(repository, /work_date BETWEEN/)
assert.match(repository, /employee_user_id =/)
assert.match(repository, /event_date BETWEEN/)

const history = await readFile('netlify/functions/_shared/portal-admin-history.mts', 'utf8')
assert.match(history, /employeeUserId/)
assert.match(history, /inspect-employee-history/)
assert.match(history, /RANGE_RESULT_TOO_LARGE/)
assert.doesNotMatch(history, /syncScheduleEmployees/)

console.log('portal admin history tests passed')
