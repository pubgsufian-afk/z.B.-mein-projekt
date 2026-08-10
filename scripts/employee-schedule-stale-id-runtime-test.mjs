import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const patchSource = await readFile('scripts/apply-employee-schedule-stale-id-recovery.mjs', 'utf8')

assert.ok(patchSource.includes("const ownEntries = await listScheduleShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })"))
assert.ok(patchSource.includes('const activeEmployees = await listActiveScheduleEmployees()'))
assert.ok(patchSource.includes('const sameNameEmployees = activeEmployees.filter'))
assert.ok(patchSource.includes('if (sameNameEmployees.length !== 1) return ownEntries'))
assert.ok(patchSource.includes("const publishedEntries = await listScheduleShifts({ from, to, publishedOnly: true })"))
assert.ok(patchSource.includes('new Map([...ownEntries, ...sameNameEntries].map((entry) => [entry.id, entry])).values()'))
assert.ok(!patchSource.includes('listEmployeeScheduleShifts'))

console.log('Employee schedule stale-ID runtime fallback test passed')
