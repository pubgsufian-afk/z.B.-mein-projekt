import assert from 'node:assert/strict'
import { resolveAssistantEmployeeWithAliases } from '../netlify/functions/_shared/schedule-employee-alias-resolution.mts'

const employees = [
  { userId: 'u-teno', fullName: 'Mohamed Teno', status: 'active' },
  { userId: 'u-omar', fullName: 'Omar Dirie', status: 'active' },
]

const alias = resolveAssistantEmployeeWithAliases('Mo', employees, [
  { alias: 'Mo', normalizedAlias: 'mo', userId: 'u-teno' },
])
assert.equal(alias.status, 'matched')
assert.equal(alias.employee?.userId, 'u-teno')

const canonicalWins = resolveAssistantEmployeeWithAliases('Omar Dirie', employees, [
  { alias: 'Omar Dirie', normalizedAlias: 'omar dirie', userId: 'u-teno' },
])
assert.equal(canonicalWins.status, 'matched')
assert.equal(canonicalWins.employee?.userId, 'u-omar')

const conflicting = resolveAssistantEmployeeWithAliases('Chef', employees, [
  { alias: 'Chef', normalizedAlias: 'chef', userId: 'u-teno' },
  { alias: 'Chef', normalizedAlias: 'chef', userId: 'u-omar' },
])
assert.equal(conflicting.status, 'ambiguous')
assert.equal(conflicting.candidates.length, 2)

const staleTarget = resolveAssistantEmployeeWithAliases('Alt', employees, [
  { alias: 'Alt', normalizedAlias: 'alt', userId: 'missing-user' },
])
assert.equal(staleTarget.status, 'not_found')

console.log('Employee alias resolution tests passed')
