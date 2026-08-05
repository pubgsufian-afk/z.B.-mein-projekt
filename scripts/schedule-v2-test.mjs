import assert from 'node:assert/strict'

globalThis.window = { addEventListener() {} }
const { exactScheduleDuplicate, netShiftMinutes } = await import('../public/schedule-v2.js')

assert.equal(netShiftMinutes('08:00', '17:00', 30), 510)
assert.equal(netShiftMinutes('07:00', '15:45', 45), 480)
assert.throws(() => netShiftMinutes('17:00', '08:00', 30), /Ungültige Dienstzeit/)
assert.throws(() => netShiftMinutes('08:00', '08:30', 30), /Ungültige Pause/)
assert.equal(exactScheduleDuplicate(
  { employeeUserId: 'u1', date: '2026-08-10', start: '08:00', end: '17:00', location: ' Werk A ', workArea: 'Zuko' },
  { employeeUserId: 'u1', date: '2026-08-10', start: '08:00', end: '17:00', location: 'werk a', workArea: 'ZUKO' },
), true)
assert.equal(exactScheduleDuplicate(
  { employeeUserId: 'u1', date: '2026-08-10', start: '08:00', end: '17:00', location: 'Werk A', workArea: 'Zuko' },
  { employeeUserId: 'u1', date: '2026-08-10', start: '09:00', end: '17:00', location: 'Werk A', workArea: 'Zuko' },
), false)

console.log('Schedule V2 tests passed · 6 assertions')
