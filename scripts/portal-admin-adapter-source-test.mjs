import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, attendance] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-schedule.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-attendance.mts', 'utf8'),
])

assert.match(schedule, /scheduleAssistant/)
assert.match(attendance, /attendanceAssistant/)
assert.match(schedule, /SCHEDULE_ASSISTANT_TOKEN/)
assert.match(attendance, /SCHEDULE_ASSISTANT_TOKEN/)
assert.match(schedule, /Authorization:\s*`Bearer \$\{token\}`/)
assert.match(attendance, /Authorization:\s*`Bearer \$\{token\}`/)
assert.match(attendance, /list-attendance/)
assert.match(attendance, /find-attendance-duplicates/)
assert.match(attendance, /update-attendance-session/)
assert.match(attendance, /delete-attendance-events/)
assert.doesNotMatch(schedule, /database\.pool\.query|\bneon\(/)
assert.doesNotMatch(attendance, /database\.pool\.query|\bneon\(/)
assert.doesNotMatch(schedule, /getDatabase|databaseConnectionString/)
assert.doesNotMatch(attendance, /getDatabase|databaseConnectionString/)

console.log('portal admin adapter source tests passed')
