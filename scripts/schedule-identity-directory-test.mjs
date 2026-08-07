import assert from 'node:assert/strict'
import {
  combineScheduleAccessRows,
  mergeScheduleIdentityDirectory,
  requestedScheduleIdentityFallback,
} from '../netlify/functions/_shared/schedule-identity-directory.mts'

const users = [
  { id: 'aras-id', email: 'aras@example.com', roles: ['pending'], name: 'Aras Identity', userMetadata: {} },
  { id: 'amin-id', email: 'amin@example.com', roles: ['pending'], userMetadata: { full_name: 'Amin' } },
  { id: 'sarmad-id', email: 'sarmad@example.com', roles: ['pending'], userMetadata: { full_name: 'Sarmad' } },
  { id: 'zayed-id', email: 'zayed@example.com', roles: ['employee'], userMetadata: { full_name: 'Zayed' } },
  { id: 'owner-id', email: 'owner@example.com', roles: [], userMetadata: { full_name: 'Owner' } },
]

const access = [
  { userId: 'sarmad-id', role: 'manager', status: 'active', fullName: 'Sarmad Portal', location: 'GMP' },
  { userId: 'zayed-id', role: 'employee', status: 'inactive', fullName: 'Zayed' },
]

const registrations = [
  { id: 'aras-id', status: 'approved', role: 'employee', fullName: 'Aras', location: 'Abbott' },
  { id: 'amin-id', status: 'pending', role: 'employee', fullName: 'Amin', location: 'Abbott' },
  { id: 'zayed-id', status: 'approved', role: 'employee', fullName: 'Zayed Alt', location: 'Abbott' },
]

const combinedAccess = combineScheduleAccessRows(access, registrations)
assert.deepEqual(combinedAccess.find((row) => row.userId === 'aras-id'), {
  userId: 'aras-id', role: 'employee', status: 'active', fullName: 'Aras', location: 'Abbott',
})
assert.equal(combinedAccess.find((row) => row.userId === 'zayed-id')?.status, 'inactive')
assert.equal(combinedAccess.some((row) => row.userId === 'amin-id'), false)

const employees = mergeScheduleIdentityDirectory(users, combinedAccess, new Set(['owner@example.com']))

assert.deepEqual(employees.map((employee) => employee.userId), ['aras-id', 'owner-id', 'sarmad-id'])
assert.deepEqual(employees.find((employee) => employee.userId === 'aras-id'), {
  userId: 'aras-id', fullName: 'Aras', role: 'employee', status: 'active', location: 'Abbott',
})
assert.deepEqual(employees.find((employee) => employee.userId === 'sarmad-id'), {
  userId: 'sarmad-id', fullName: 'Sarmad Portal', role: 'manager', status: 'active', location: 'GMP',
})
assert.equal(employees.find((employee) => employee.userId === 'owner-id')?.role, 'owner')
assert.equal(employees.some((employee) => employee.userId === 'amin-id'), false)
assert.equal(employees.some((employee) => employee.userId === 'zayed-id'), false)

const requestedFallback = requestedScheduleIdentityFallback(
  users,
  combinedAccess,
  new Set(['owner@example.com']),
  ['Amin', 'Zayed', 'Nicht Vorhanden'],
)
assert.deepEqual(requestedFallback, [{
  userId: 'amin-id', fullName: 'Amin', role: 'employee', status: 'active', location: '',
}])

console.log('Schedule Identity directory tests passed')
