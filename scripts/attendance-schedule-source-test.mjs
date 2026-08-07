import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/attendance.mts', 'utf8')

assert.match(
  source,
  /import \{ listScheduleShifts \} from '\.\/_shared\/schedule-neon-repository\.mts'/,
  'Die Zeiterfassung muss denselben Neon-Dienstplan wie die Dienstplan-Seite lesen.',
)
assert.match(
  source,
  /async function loadSchedules\(\): Promise<ScheduleEntry\[]> \{\s*return listScheduleShifts\(\)\s*\}/s,
  'loadSchedules muss den gemeinsamen Neon-Dienstplan verwenden.',
)
assert.doesNotMatch(
  source,
  /async function loadSchedules[\s\S]*?portal-schedule-v2[\s\S]*?\n\}/,
  'Die Zeiterfassung darf den alten Blob-Dienstplan nicht mehr als Quelle verwenden.',
)

console.log('Attendance schedule source test passed')
