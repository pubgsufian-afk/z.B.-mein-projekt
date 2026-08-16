import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-assistant.mts', 'utf8')

for (const action of ['list-shifts', 'get-shift', 'find-duplicates', 'update-shift', 'delete-shift']) {
  assert.match(source, new RegExp(`action === '${action}'`), `Missing management action ${action}`)
}
assert.match(source, /MAX_RANGE_DAYS/)
assert.match(source, /MAX_LIST_RESULTS/)
assert.match(source, /AMBIGUOUS_EMPLOYEE/)
assert.match(source, /TIME_DUPLICATE/)
assert.match(source, /EXACT_DUPLICATE/)
assert.match(source, /action: 'shift-updated'/)
assert.match(source, /action: 'shift-deleted'/)
assert.match(source, /details: \{ requestId, before:/)

const updateStart = source.indexOf('async function updateAssistantShift')
const updateRead = source.indexOf('await findScheduleShift(shiftId)', updateStart)
const updateWrite = source.indexOf('await upsertScheduleShift(candidate)', updateStart)
const updateVerify = source.indexOf('await findScheduleShift(candidate.id)', updateStart)
assert.ok(updateStart >= 0 && updateRead > updateStart && updateWrite > updateRead && updateVerify > updateWrite)

const deleteStart = source.indexOf('async function deleteAssistantShift')
const deleteRead = source.indexOf('await findScheduleShift(shiftId)', deleteStart)
const deleteWrite = source.indexOf('await deleteScheduleShift(shiftId)', deleteStart)
assert.ok(deleteStart >= 0 && deleteRead > deleteStart && deleteWrite > deleteRead)

assert.doesNotMatch(source.slice(deleteStart, deleteWrite), /deleteScheduleShift\(text\(body\.employeeName\)/)

const updateSource = source.slice(updateStart, deleteStart)
assert.doesNotMatch(updateSource, /allowUnregistered/)
assert.doesNotMatch(updateSource, /provisionalEmployeeUserId/)
assert.match(updateSource, /resolveAssistantEmployee\(rawChanges\.employeeName, employees\)/)
assert.match(updateSource, /EMPLOYEE_NOT_FOUND/)

console.log('Schedule assistant management source tests passed')
