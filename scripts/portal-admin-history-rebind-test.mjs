import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createEmployeeHistoryRebindService,
  normalizeEmployeeHistoryRebind,
} from '../netlify/functions/_shared/employee-history-rebind.mts'

const normalized = normalizeEmployeeHistoryRebind({
  sourceUserId: 'guest:abc',
  targetUserId: 'registered-kwame',
  targetFullName: 'Kwame Akakpo',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
  reason: 'Registriertes Konto zuordnen',
})
assert.deepEqual(normalized.range, { from: '2026-08-01', to: '2026-08-24' })
assert.deepEqual(normalized.domains, ['schedule', 'attendance'])
assert.throws(() => normalizeEmployeeHistoryRebind({
  sourceUserId: 'same', targetUserId: 'same', targetFullName: 'A', from: '2026-08-01', to: '2026-08-24', domains: ['schedule'], reason: 'x',
}), /unterschiedlich/)
assert.throws(() => normalizeEmployeeHistoryRebind({
  sourceUserId: 'guest:a', targetUserId: 'guest:b', targetFullName: 'B', from: '2026-08-01', to: '2026-08-24', domains: ['schedule'], reason: 'x',
}), /registriert/)

const calls = []
const service = createEmployeeHistoryRebindService({
  async rebindSchedule(input) {
    calls.push(['schedule', input.from, input.to])
    return { shiftCount: 2, timesheetCount: 2 }
  },
  async rebindAttendance(input) {
    calls.push(['attendance', input.from, input.to])
    return { eventCount: 4, adjustmentCount: 1, locationCount: 2 }
  },
})
const result = await service.rebind(normalized, {
  userId: 'portal-admin-relay', email: 'portal-admin-relay@internal.invalid', role: 'owner',
})
assert.deepEqual(calls, [
  ['schedule', '2026-08-01', '2026-08-24'],
  ['attendance', '2026-08-01', '2026-08-24'],
])
assert.equal(result.schedule.shiftCount, 2)
assert.equal(result.attendance.eventCount, 4)
assert.equal(result.attendance.locationCount, 2)

const source = await readFile('netlify/functions/_shared/employee-history-rebind.mts', 'utf8')
for (const needle of [
  'shift_date BETWEEN',
  'work_date BETWEEN',
  'event_date BETWEEN',
  'attendance_legal_holds',
  'attendance_adjustments',
  'UPDATE attendance_locations',
  'attendance_audit_log',
  'schedule_audit_log',
  'admin-employee-rebind',
  'locationCount',
]) assert.ok(source.includes(needle), `missing ${needle}`)

console.log('portal admin history rebind tests passed')
