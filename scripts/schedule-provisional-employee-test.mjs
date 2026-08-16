import assert from 'node:assert/strict'
import {
  isProvisionalEmployeeUserId,
  provisionalEmployeeUserId,
} from '../netlify/functions/_shared/schedule-provisional-employee.mts'

assert.equal(isProvisionalEmployeeUserId('guest:abc'), true)
assert.equal(isProvisionalEmployeeUserId('real-user-id'), false)
assert.equal(isProvisionalEmployeeUserId(''), false)

assert.equal(
  provisionalEmployeeUserId('Gast Beispiel'),
  provisionalEmployeeUserId('  gast   beispiel  '),
)
assert.notEqual(
  provisionalEmployeeUserId('Gast Beispiel'),
  provisionalEmployeeUserId('Gast Beispiel Zwei'),
)
assert.notEqual(
  provisionalEmployeeUserId('Gast Beispiel'),
  provisionalEmployeeUserId('Gast Beispie1'),
)
assert.equal(provisionalEmployeeUserId('   '), '')
assert.match(provisionalEmployeeUserId('Gast Beispiel'), /^guest:[a-f0-9]{64}$/)

console.log('Schedule provisional employee tests passed')
