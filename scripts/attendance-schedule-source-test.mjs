import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance.mts', 'utf8')

assert.match(
  source,
  /import\s*\{\s*listScheduleShifts\s*\}\s*from\s*['"]\.\/_shared\/schedule-neon-repository\.mts['"]/,
  'Die Zeiterfassung muss denselben Neon-Dienstplan wie die Dienstplan-Seite lesen.',
)

const loaderStart = source.indexOf('async function loadSchedules')
assert.ok(loaderStart >= 0, 'loadSchedules wurde in der Zeiterfassung nicht gefunden.')
const nextFunction = source.indexOf('\nasync function ', loaderStart + 1)
const loaderSource = source.slice(loaderStart, nextFunction >= 0 ? nextFunction : source.length)

assert.match(
  loaderSource,
  /return\s+listScheduleShifts\s*\(\s*\)/,
  'loadSchedules muss den gemeinsamen Neon-Dienstplan verwenden.',
)
assert.doesNotMatch(
  loaderSource,
  /portal-schedule-v2|getStore\s*\(/,
  'loadSchedules darf den alten Blob-Dienstplan nicht mehr als Quelle verwenden.',
)

console.log('Attendance schedule source test passed')