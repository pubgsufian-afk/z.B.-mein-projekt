import assert from 'node:assert/strict'
import {
  resolveAssistantEmployee,
  resolveAssistantSchedulePerson,
} from '../netlify/functions/_shared/schedule-assistant-core.mts'

// Regression: a commonly used short name may be the final token of the registered full name.
const uniqueTokenDirectory = [
  { userId: 'u-teno', fullName: 'Mohamed Teno', role: 'employee', status: 'active', location: 'Abbott' },
  { userId: 'u-omar', fullName: 'Omar Dirie', role: 'employee', status: 'active', location: 'Abbott' },
]

const teno = resolveAssistantEmployee('Teno', uniqueTokenDirectory)
assert.equal(teno.status, 'matched')
assert.equal(teno.employee?.userId, 'u-teno')
assert.equal(teno.employee?.fullName, 'Mohamed Teno')

const ambiguousTokenDirectory = [
  { userId: 'u-ahmed-1', fullName: 'Mohamed Ahmed Warsame', role: 'employee', status: 'active', location: 'Abbott' },
  { userId: 'u-ahmed-2', fullName: 'Ahmed Zarzour', role: 'employee', status: 'active', location: 'Abbott' },
]

const ahmed = resolveAssistantEmployee('Ahmed', ambiguousTokenDirectory)
assert.equal(ahmed.status, 'ambiguous')
assert.equal(ahmed.candidates.length, 2)

const provisionalDirectory = [
  { userId: 'guest:kanee', fullName: 'Kanee' },
]

const unapprovedExistingGuest = resolveAssistantSchedulePerson(
  'Kanee',
  uniqueTokenDirectory,
  provisionalDirectory,
  [],
)
assert.equal(unapprovedExistingGuest.status, 'not_found')

const approvedExistingGuest = resolveAssistantSchedulePerson(
  'Kanee',
  uniqueTokenDirectory,
  provisionalDirectory,
  ['Kanee'],
)
assert.equal(approvedExistingGuest.status, 'matched')
assert.equal(approvedExistingGuest.employee?.userId, 'guest:kanee')
assert.equal(approvedExistingGuest.provisional, true)

console.log('Schedule assistant short-name regression tests passed')
