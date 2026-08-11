import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance-assistant.mts', 'utf8')
for (const needle of [
  'databaseConnectionString',
  'getDatabase',
  'listScheduleShifts',
  'SCHEDULE_ASSISTANT_TOKEN',
  'attendance_events',
  'attendance_adjustments',
  'schedule_employees',
  'attendance_legal_holds',
  'attendance_audit_log',
  'MAX_ATTENDANCE_RANGE_DAYS',
  'list-attendance',
  'find-attendance-duplicates',
  'update-attendance-session',
  'delete-attendance-events',
  'detectAttendanceDuplicates',
]) assert.ok(source.includes(needle), `missing ${needle}`)
assert.ok(source.match(/entity_id = ANY\(\$1::text\[\]\)/), 'session edits/deletes must query legal holds by exact event IDs')
assert.ok(!source.includes('getUser('), 'assistant must not depend on portal session auth')
console.log('attendance assistant source contract passed')
