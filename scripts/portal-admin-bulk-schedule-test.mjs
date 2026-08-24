import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { scheduleShiftBusinessEqual } from '../netlify/functions/_shared/portal-admin-bulk-schedule.mts'

const base = {
  employeeUserId: 'u1', employeeName: 'A', date: '2026-08-24', start: '08:00', end: '16:00',
  pauseMinutes: 30, objectId: 'o1', location: 'Abbott', workArea: 'GMP', note: '', status: 'published',
}
assert.equal(scheduleShiftBusinessEqual(base, { ...base }), true)
assert.equal(scheduleShiftBusinessEqual(base, { ...base, pauseMinutes: 60 }), false)

const [service, adapter, capabilities] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-bulk-schedule.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-schedule.mts', 'utf8'),
  readFile('ops/portal-admin-capabilities.json', 'utf8'),
])
for (const needle of [
  'bulkUpdateScheduleShifts',
  'updates.slice(0, 100)',
  'findScheduleShift',
  'classifyAssistantDuplicate',
  'validateAssistantShiftInput',
  'upsertScheduleShift',
  'writeScheduleAudit',
  'changed: false',
]) assert.ok(service.includes(needle), `missing ${needle}`)
assert.ok(!service.includes('syncScheduleEmployees'), 'bulk update must not force a full directory sync')
assert.match(adapter, /bulk-update-shifts/)
assert.match(capabilities, /"schedule\.bulk-update-shifts"/)

console.log('portal admin bulk schedule tests passed')
