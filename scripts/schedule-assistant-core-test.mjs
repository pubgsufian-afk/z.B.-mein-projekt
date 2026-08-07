import assert from 'node:assert/strict'
import {
  defaultAssistantLocation,
  normalizeAssistantName,
  resolveAssistantEmployee,
  validateAssistantShiftInput,
} from '../netlify/functions/_shared/schedule-assistant-core.mts'

const employees = [
  { userId: '1', fullName: 'Aras', role: 'employee', status: 'active', location: 'Abbott' },
  { userId: '2', fullName: 'Amín  Test', role: 'employee', status: 'active', location: '' },
  { userId: '3', fullName: 'Amin Test', role: 'employee', status: 'active', location: 'GMP' },
]

assert.equal(normalizeAssistantName('  AMÍN   Test '), 'amin test')

const exact = resolveAssistantEmployee('Aras', employees)
assert.equal(exact.status, 'matched')
assert.equal(exact.employee?.userId, '1')

const ambiguous = resolveAssistantEmployee('amin test', employees)
assert.equal(ambiguous.status, 'ambiguous')
assert.equal(ambiguous.candidates.length, 2)

const missing = resolveAssistantEmployee('Sarmad', employees)
assert.equal(missing.status, 'not_found')
assert.equal(missing.candidates.length, 0)

assert.equal(defaultAssistantLocation({ location: ' GMP ' }), 'GMP')
assert.equal(defaultAssistantLocation({ location: '   ' }), 'Abbott')

assert.deepEqual(validateAssistantShiftInput({
  employeeName: 'Aras', date: '2026-08-08', start: '06:00', end: '17:00', workArea: 'ZuKo', pauseMinutes: 0,
}), { ok: true })

assert.match(validateAssistantShiftInput({
  employeeName: 'Aras', date: '08.08.2026', start: '06:00', end: '17:00', workArea: 'ZuKo',
}).message || '', /Datum/)

assert.match(validateAssistantShiftInput({
  employeeName: 'Aras', date: '2026-08-08', start: '17:00', end: '06:00', workArea: 'ZuKo',
}).message || '', /Ende/)

assert.match(validateAssistantShiftInput({
  employeeName: 'Aras', date: '2026-08-08', start: '06:00', end: '17:00', workArea: '',
}).message || '', /Bereich/)

console.log('Schedule assistant core tests passed')
