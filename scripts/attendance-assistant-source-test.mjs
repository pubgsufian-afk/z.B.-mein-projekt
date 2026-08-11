import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance-assistant.mts', 'utf8')
for (const needle of [
  'databaseConnectionString',
  'SCHEDULE_ASSISTANT_TOKEN',
  'attendance_events',
  'attendance_adjustments',
  'schedule_shifts',
  'schedule_employees',
  'attendance_legal_holds',
  'attendance_audit_log',
  'list-attendance',
  'find-attendance-duplicates',
  'update-attendance-session',
  'delete-attendance-events',
  'detectAttendanceDuplicates',
]) assert.ok(source.includes(needle), `missing ${needle}`)
assert.ok(!source.includes('getUser('), 'assistant must not depend on portal session auth')
console.log('attendance assistant source contract passed')
