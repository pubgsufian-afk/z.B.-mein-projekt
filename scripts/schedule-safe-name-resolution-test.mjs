import assert from 'node:assert/strict'
import * as assistantCore from '../netlify/functions/_shared/schedule-assistant-core.mts'

const { resolveAssistantEmployee } = assistantCore

const employees = [
  { userId: 'registered-1', fullName: 'Murtada Example', role: 'employee', status: 'active' },
  { userId: 'registered-2', fullName: 'Mohamed Ahmed Sample', role: 'employee', status: 'active' },
  { userId: 'registered-3', fullName: 'Ahmad Zarsur', role: 'employee', status: 'active' },
]

const oneLetterTypo = resolveAssistantEmployee('Murtaza', employees)
assert.equal(oneLetterTypo.status, 'matched')
assert.equal(oneLetterTypo.employee?.userId, 'registered-1')

const exactTokenWins = resolveAssistantEmployee('Ahmed', employees)
assert.equal(exactTokenWins.status, 'matched')
assert.equal(exactTokenWins.employee?.userId, 'registered-2')

const twoTokenTypos = resolveAssistantEmployee('Ahmed Zersur', employees)
assert.equal(twoTokenTypos.status, 'matched')
assert.equal(twoTokenTypos.employee?.userId, 'registered-3')

const ambiguousEmployees = [
  { userId: 'amb-1', fullName: 'Murtada Alpha', role: 'employee', status: 'active' },
  { userId: 'amb-2', fullName: 'Murtaba Beta', role: 'employee', status: 'active' },
]
const ambiguousTypo = resolveAssistantEmployee('Murtaza', ambiguousEmployees)
assert.equal(ambiguousTypo.status, 'ambiguous')

assert.equal(typeof assistantCore.resolveAssistantSchedulePerson, 'function')
if (typeof assistantCore.resolveAssistantSchedulePerson === 'function') {
  const provisionalEmployees = [
    { userId: 'guest:known', fullName: 'Kani Example' },
  ]

  const registeredWins = assistantCore.resolveAssistantSchedulePerson(
    'Murtaza',
    employees,
    provisionalEmployees,
    [],
  )
  assert.equal(registeredWins.status, 'matched')
  assert.equal(registeredWins.employee?.userId, 'registered-1')
  assert.equal(registeredWins.provisional, false)

  const knownProvisional = assistantCore.resolveAssistantSchedulePerson(
    'Kani Example',
    employees,
    provisionalEmployees,
    [],
  )
  assert.equal(knownProvisional.status, 'matched')
  assert.equal(knownProvisional.employee?.userId, 'guest:known')
  assert.equal(knownProvisional.provisional, true)

  const unknown = assistantCore.resolveAssistantSchedulePerson(
    'Completely New Person',
    employees,
    provisionalEmployees,
    [],
  )
  assert.equal(unknown.status, 'not_found')

  const explicitlyApproved = assistantCore.resolveAssistantSchedulePerson(
    'Completely New Person',
    employees,
    provisionalEmployees,
    ['Completely New Person'],
  )
  assert.equal(explicitlyApproved.status, 'approved_unregistered')
  assert.equal(explicitlyApproved.fullName, 'Completely New Person')
}

console.log('Safe schedule name resolution tests passed')
