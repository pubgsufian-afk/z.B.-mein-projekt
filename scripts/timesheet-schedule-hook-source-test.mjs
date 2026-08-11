import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

await import('./apply-timesheet-schedule-hooks.mjs')
const [portal, assistant, sync] = await Promise.all([
  readFile('netlify/functions/schedule-v2-neon.mts', 'utf8'),
  readFile('netlify/functions/schedule-assistant.mts', 'utf8'),
  readFile('netlify/functions/_shared/timesheet-schedule-sync.mts', 'utf8'),
])

assert.match(portal, /syncPublishedScheduleShift\(shift, current\.userId, new Date\(\)\)/)
assert.match(portal, /syncPublishedScheduleRange\(week, addDays\(week, 6\), current\.userId, new Date\(\)\)/)
assert.match(portal, /removeScheduleShiftFromTimesheet\(id, existing\.date, current\.userId, new Date\(\)\)/)
assert.match(assistant, /syncPublishedScheduleShift\(shift, ACTOR_ID, new Date\(\)\)/)
assert.match(assistant, /syncPublishedScheduleShift\(saved, ACTOR_ID, new Date\(\)\)/)
assert.match(assistant, /removeScheduleShiftFromTimesheet\(shiftId, existing\.date, ACTOR_ID, new Date\(\)\)/)
assert.doesNotMatch(sync, /attendance_events/)
console.log('timesheet schedule hook source contract passed')
