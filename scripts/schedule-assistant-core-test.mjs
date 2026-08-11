import assert from 'node:assert/strict'
import {
  assistantPersonMatch,
  classifyAssistantDuplicate,
  DEFAULT_ASSISTANT_WORKSITE_NAME,
  defaultAssistantLocation,
  findAssistantTimeDuplicate,
  normalizeAssistantName,
  resolveAssistantEmployee,
  resolveAssistantWorksite,
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

const worksites = [
  { id: 'abbott-id', name: 'Abbott Laboratories GmbH', latitude: 50.1, longitude: 8.6, radiusMeters: 500 },
  { id: 'south-id', name: 'Objekt Süd', latitude: 49.4, longitude: 8.7, radiusMeters: 250 },
]

assert.equal(DEFAULT_ASSISTANT_WORKSITE_NAME, 'Abbott Laboratories GmbH')

const defaultWorksite = resolveAssistantWorksite('', worksites)
assert.equal(defaultWorksite.status, 'matched')
assert.equal(defaultWorksite.worksite?.id, 'abbott-id')

const explicitWorksite = resolveAssistantWorksite(' objekt süd ', worksites)
assert.equal(explicitWorksite.status, 'matched')
assert.equal(explicitWorksite.worksite?.id, 'south-id')

assert.equal(resolveAssistantWorksite('Unbekannt', worksites).status, 'not_found')
assert.equal(resolveAssistantWorksite('Abbott Laboratories GmbH', [
  ...worksites,
  { id: 'abbott-copy', name: 'Abbott Laboratories GmbH', latitude: 50.2, longitude: 8.7, radiusMeters: 300 },
]).status, 'ambiguous')

for (const invalidWorksite of [
  { id: '', name: 'Abbott Laboratories GmbH', latitude: 50.1, longitude: 8.6, radiusMeters: 500 },
  { id: 'bad-latitude', name: 'Abbott Laboratories GmbH', latitude: null, longitude: 8.6, radiusMeters: 500 },
  { id: 'bad-longitude', name: 'Abbott Laboratories GmbH', latitude: 50.1, longitude: 181, radiusMeters: 500 },
  { id: 'bad-radius', name: 'Abbott Laboratories GmbH', latitude: 50.1, longitude: 8.6, radiusMeters: null },
]) {
  assert.equal(resolveAssistantWorksite('', [invalidWorksite]).status, 'unconfigured')
}

const timeDuplicate = findAssistantTimeDuplicate(
  { start: '07:00', end: '17:00' },
  [
    { id: 'other-time', start: '07:00', end: '16:00' },
    { id: 'same-time', start: '07:00', end: '17:00', location: 'Alter Text', pauseMinutes: 60 },
  ],
)
assert.equal(timeDuplicate?.id, 'same-time')
assert.equal(findAssistantTimeDuplicate({ start: '07:00', end: '17:00' }, [
  { id: 'other-time', start: '08:00', end: '17:00' },
]), null)

const uniqueDirectory = [
  { userId: 'new-aras', fullName: 'Aras Khalaf', role: 'employee', status: 'active', location: 'Abbott' },
]
assert.equal(assistantPersonMatch(
  { employeeUserId: 'old-aras', employeeName: 'Aras Khalaf' },
  { employeeUserId: 'new-aras', employeeName: 'Aras Khalaf' },
  uniqueDirectory,
).status, 'same')

const duplicateNames = [
  { userId: 'a1', fullName: 'Amin Ali', role: 'employee', status: 'active' },
  { userId: 'a2', fullName: 'Amin Ali', role: 'employee', status: 'active' },
]
assert.equal(assistantPersonMatch(
  { employeeUserId: 'old', employeeName: 'Amin Ali' },
  { employeeUserId: 'a1', employeeName: 'Amin Ali' },
  duplicateNames,
).status, 'ambiguous')

const duplicateResult = classifyAssistantDuplicate(
  { employeeUserId: 'new-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  [
    { id: 'old-id', employeeUserId: 'old-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  ],
  uniqueDirectory,
)
assert.equal(duplicateResult.exact?.id, 'old-id')

const timeResult = classifyAssistantDuplicate(
  { employeeUserId: 'new-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  [
    { id: 'same-time', employeeUserId: 'old-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'Brandwache' },
  ],
  uniqueDirectory,
)
assert.equal(timeResult.time?.id, 'same-time')

const overlapResult = classifyAssistantDuplicate(
  { employeeUserId: 'new-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  [
    { id: 'overlap', employeeUserId: 'old-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '13:00', end: '15:00', location: 'Abbott', workArea: 'Brandwache' },
  ],
  uniqueDirectory,
)
assert.equal(overlapResult.overlaps[0]?.id, 'overlap')

const ambiguousResult = classifyAssistantDuplicate(
  { employeeUserId: 'old', employeeName: 'Amin Ali', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  [
    { id: 'amb', employeeUserId: 'a1', employeeName: 'Amin Ali', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  ],
  duplicateNames,
)
assert.equal(ambiguousResult.ambiguous.length, 1)
assert.equal(ambiguousResult.exact, null)

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
