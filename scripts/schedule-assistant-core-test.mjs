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

const shortNameEmployees = [
  { userId: '4', fullName: 'Aras Khalaf', role: 'employee', status: 'active', location: 'Abbott' },
  { userId: '5', fullName: 'Amin Hassan', role: 'employee', status: 'active', location: 'GMP' },
  { userId: '6', fullName: 'Amin Ali', role: 'employee', status: 'active', location: 'GMP' },
]

const uniqueFirstName = resolveAssistantEmployee('Aras', shortNameEmployees)
assert.equal(uniqueFirstName.status, 'matched')
assert.equal(uniqueFirstName.employee?.userId, '4')

const ambiguousFirstName = resolveAssistantEmployee('Amin', shortNameEmployees)
assert.equal(ambiguousFirstName.status, 'ambiguous')
assert.equal(ambiguousFirstName.candidates.length, 2)

const surnameOnly = resolveAssistantEmployee('Khalaf', shortNameEmployees)
assert.equal(surnameOnly.status, 'not_found')

const partialFullName = resolveAssistantEmployee('Aras K', shortNameEmployees)
assert.equal(partialFullName.status, 'not_found')

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
