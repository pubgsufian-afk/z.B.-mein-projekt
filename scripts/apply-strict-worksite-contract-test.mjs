import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'scripts/attendance-api-contract-test.mjs'
let source = await readFile(path, 'utf8')

if (!source.includes('CHECK_IN_WORKSITE_REQUIRED')) {
  const oldBlock = `const unavailable = await service2.record(employee, {
  action: 'clock-in', clientEventId: 'client-y', clientOccurredAt: '2026-08-06T08:00:00.000Z', objectId: 'missing', location: null,
})
assert.equal(unavailable.event.locationStatus, 'unavailable')`

  assert.ok(source.includes(oldBlock), 'Legacy unavailable clock-in contract marker missing')

  const newBlock = `await assert.rejects(() => service2.record(employee, {
  action: 'clock-in', clientEventId: 'client-y', clientOccurredAt: '2026-08-06T08:00:00.000Z', objectId: 'missing', location: null,
}), (error) => {
  assert.equal(error.code, 'CHECK_IN_WORKSITE_REQUIRED')
  return true
})

await assert.rejects(() => service2.record(employee, {
  action: 'clock-in', clientEventId: 'client-z', clientOccurredAt: '2026-08-06T08:01:00.000Z', objectId: 'outside-site',
  location: { latitude: 52.375, longitude: 9.732, accuracyMeters: 12 },
}), /Arbeitsbeginn ist nur am vorgesehenen Einsatzort möglich/)`

  source = source.replace(oldBlock, newBlock)
  source = source.replace('Attendance API contract tests passed · 25 assertions', 'Attendance API contract tests passed · strict worksite policy')
}

assert.match(source, /CHECK_IN_WORKSITE_REQUIRED/)
assert.match(source, /Arbeitsbeginn ist nur am vorgesehenen Einsatzort möglich/)
assert.doesNotMatch(source, /assert\.equal\(unavailable\.event\.locationStatus, 'unavailable'\)/)
await writeFile(path, source)

console.log('Attendance API contract aligned with strict worksite check-in')
