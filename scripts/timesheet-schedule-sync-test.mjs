import assert from 'node:assert/strict'
import {
  createTimesheetScheduleSync,
  plannedNetMinutes,
  syncDecision,
} from '../netlify/functions/_shared/timesheet-schedule-sync.mts'

assert.equal(syncDecision({ monthOpen: true, status: 'published', manualOverride: false }), 'upsert')
assert.equal(syncDecision({ monthOpen: false, status: 'published', manualOverride: false }), 'ignore')
assert.equal(syncDecision({ monthOpen: true, status: 'published', manualOverride: true }), 'ignore')
assert.equal(syncDecision({ monthOpen: true, status: 'draft', manualOverride: false }), 'delete')
assert.equal(plannedNetMinutes('2026-08-10', '10:00', '17:00', 60), 360)

const saved = new Map()
const audits = []
const shifts = [
  { id: 'aug', employeeUserId: 'u1', employeeName: 'A', date: '2026-08-10', start: '10:00', end: '17:00', pauseMinutes: 60, location: 'Abbott', workArea: 'GMP', status: 'published' },
  { id: 'jul', employeeUserId: 'u1', employeeName: 'A', date: '2026-07-10', start: '07:00', end: '17:00', pauseMinutes: 60, location: 'Abbott', workArea: 'GMP', status: 'published' },
]
const service = createTimesheetScheduleSync({
  listScheduleShifts: async () => shifts,
  ensureTimesheetMonth: async () => {},
  findTimesheetEntryByScheduleShiftId: async (id) => saved.get(id) || null,
  upsertScheduleTimesheetEntry: async (row) => { const savedRow = { id: `ts-${row.scheduleShiftId}`, ...row }; saved.set(row.scheduleShiftId, savedRow); return savedRow },
  deleteScheduleTimesheetEntryByShiftId: async (id) => { const row = saved.get(id) || null; saved.delete(id); return row },
  listScheduleLinkedTimesheetEntries: async () => [...saved.values()],
  writeTimesheetAudit: async (entry) => { audits.push(entry) },
})

await service.syncPublishedScheduleRange('2026-07-01', '2026-08-31', 'tester', new Date('2026-08-11T21:30:00Z'))
assert.equal(saved.has('aug'), true, 'August must materialize while open')
assert.equal(saved.has('jul'), false, 'July must not be rebuilt after its correction deadline')
assert.equal(audits.length, 1)

saved.set('manual', {
  id: 'ts-manual', scheduleShiftId: 'manual', employeeUserId: 'u1', employeeName: 'A', workDate: '2026-08-12', start: '10:00', end: '17:00', pauseMinutes: 60, netMinutes: 360, location: 'Abbott', workArea: 'GMP', source: 'manual', manualOverride: true,
})
const manualShift = { id: 'manual', employeeUserId: 'u1', employeeName: 'A', date: '2026-08-12', start: '08:00', end: '18:00', pauseMinutes: 0, location: 'Abbott', workArea: 'GMP', status: 'published' }
await service.syncPublishedScheduleShift(manualShift, 'tester', new Date('2026-08-11T21:30:00Z'))
assert.equal(saved.get('manual').start, '10:00', 'manual override must survive schedule sync')

const provisionalShift = {
  id: 'guest-shift',
  employeeUserId: `guest:${'a'.repeat(64)}`,
  employeeName: 'Gast Beispiel',
  date: '2026-08-13',
  start: '08:30',
  end: '17:00',
  pauseMinutes: 30,
  location: 'Test Einsatzort',
  workArea: 'Bauhelfer',
  status: 'published',
}
await service.syncPublishedScheduleShift(provisionalShift, 'tester', new Date('2026-08-11T21:30:00Z'))
const provisionalEntry = saved.get('guest-shift')
assert.ok(provisionalEntry, 'provisional published shift must materialize in timesheets')
assert.equal(provisionalEntry.employeeUserId, provisionalShift.employeeUserId)
assert.equal(provisionalEntry.employeeName, 'Gast Beispiel')
assert.equal(provisionalEntry.pauseMinutes, 30)
assert.equal(provisionalEntry.netMinutes, 480)
assert.equal(provisionalEntry.workArea, 'Bauhelfer')
assert.equal(provisionalEntry.location, 'Test Einsatzort')

console.log('timesheet schedule sync tests passed')
