import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveAssistantEmployeeWithAliases } from '../netlify/functions/_shared/schedule-employee-alias-resolution.mts'

const employees = Array.from({ length: 250 }, (_, index) => ({
  userId: `employee-${index + 1}`,
  fullName: `Worker Token${String(index + 1).padStart(3, '0')}`,
  role: 'employee',
  status: 'active',
}))
employees.push({ userId: 'employee-teno', fullName: 'Mohamed Teno', role: 'employee', status: 'active' })

for (let index = 1; index <= 100; index += 1) {
  const token = `Token${String(index).padStart(3, '0')}`
  const resolved = resolveAssistantEmployeeWithAliases(token, employees, [])
  assert.equal(resolved.status, 'matched', `expected ${token} to resolve uniquely`)
  assert.equal(resolved.employee?.userId, `employee-${index}`)
}

const teno = resolveAssistantEmployeeWithAliases('Teno', employees, [])
assert.equal(teno.status, 'matched')
assert.equal(teno.employee?.userId, 'employee-teno')

const source = await readFile('netlify/functions/schedule-assistant.mts', 'utf8')
assert.equal((source.match(/await activePortalEmployees\(/g) || []).length, 1, 'directory must be loaded once per assistant request')

const publishStart = source.indexOf("if (action === 'publish-shifts')")
assert.ok(publishStart >= 0, 'publish-shifts handler missing')
const publish = source.slice(publishStart)
assert.equal((publish.match(/await listEmployeeAliases\(\)/g) || []).length, 1, 'aliases must be loaded once per publish batch')
assert.equal((publish.match(/await activePortalWorksites\(\)/g) || []).length, 1, 'worksites must be loaded once per publish batch')
assert.match(publish, /const resolvedEmployees = new Map/)
assert.match(publish, /preflightFailed/)
assert.match(publish, /results\.push\(await publishOne/)

console.log('PR73 cost-path test passed for 251 registered employees and 100 resolved schedule names')
