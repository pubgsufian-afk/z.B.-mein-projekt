import assert from 'node:assert/strict'
import { resolveAssistantEmployee } from '../netlify/functions/_shared/schedule-assistant-core.mts'

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

console.log('Safe schedule name resolution tests passed')
