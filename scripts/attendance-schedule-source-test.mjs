import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance.mts', 'utf8')
const loadSchedules = source.match(/async function loadSchedules\(\): Promise<ScheduleEntry\[]> \{[\s\S]*?\n\}/)?.[0] || ''

assert.match(
  loadSchedules,
  /await import\('\.\/_shared\/schedule-neon-repository\.mts'\)/,
  'Die Zeiterfassung muss denselben Neon-Dienstplan wie die Dienstplan-Seite lesen.',
)
assert.match(
  loadSchedules,
  /return listScheduleShifts\(\)/,
  'loadSchedules muss den gemeinsamen Neon-Dienstplan verwenden.',
)
assert.doesNotMatch(
  loadSchedules,
  /portal-schedule-v2|@netlify\/blobs/,
  'Die Zeiterfassung darf den alten Blob-Dienstplan nicht mehr als Quelle verwenden.',
)

console.log('Attendance schedule source test passed')
