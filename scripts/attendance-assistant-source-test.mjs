import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance-assistant.mts', 'utf8')
const service = await readFile('netlify/functions/_shared/attendance-admin-service.mts', 'utf8')
for (const needle of [
  'databaseConnectionString',
  'getDatabase',
  'listScheduleShifts',
  'SCHEDULE_ASSISTANT_TOKEN',
  'attendance_events',
  'attendance_adjustments',
  'schedule_employees',
  'MAX_ATTENDANCE_RANGE_DAYS',
  'list-attendance',
  'find-attendance-duplicates',
  'update-attendance-session',
  'delete-attendance-events',
  'detectAttendanceDuplicates',
  'attendance-admin-service.mts',
  'attendanceAdminService()',
  'updateSession',
  'deleteEvents',
  "userId: 'portal-admin-relay'",
  "role: 'owner'",
]) assert.ok(source.includes(needle), `missing ${needle}`)
assert.ok(service.match(/entity_id = ANY\(\$1::text\[\]\)/), 'shared mutations must query legal holds by exact event IDs')
assert.ok(service.includes('attendance_audit_log'), 'shared mutations must write attendance audit records')
assert.ok(!source.includes('getUser('), 'assistant must not depend on portal session auth')
assert.ok(!source.includes('INSERT INTO attendance_audit_log'), 'assistant must not duplicate mutation SQL')

console.log('attendance assistant source contract passed')
