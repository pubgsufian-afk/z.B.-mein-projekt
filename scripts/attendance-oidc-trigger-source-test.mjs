import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-oidc-trigger.mts', 'utf8')
for (const needle of [
  "import attendanceAssistant from './attendance-assistant.mts'",
  'isAttendanceAction',
  'list-attendance',
  'find-attendance-duplicates',
  'update-attendance-session',
  'delete-attendance-events',
  'encryptedResult',
]) assert.ok(source.includes(needle), `missing ${needle}`)
console.log('attendance OIDC trigger source contract passed')
