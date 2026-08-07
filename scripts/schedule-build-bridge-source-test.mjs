import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('scripts/process-schedule-command-build.mjs', 'utf8')

assert.match(source, /ops\/schedule-command\.envelope\.json/)
assert.match(source, /SCHEDULE_COMMAND_PRIVATE_KEY_B64/)
assert.match(source, /decryptScheduleCommandEnvelope/)
assert.match(source, /SCHEDULE_ASSISTANT_BRIDGE_TOKEN/)
assert.match(source, /https:\/\/habun-mitarbeiterportal\.netlify\.app\/api\/schedule-assistant/)
assert.match(source, /Authorization/)
assert.match(source, /Bearer/)
assert.match(source, /publish-shifts/)
assert.match(source, /sync-directory/)
assert.match(source, /schedule-command-result\.json/)
assert.doesNotMatch(source, /process\.env\.SCHEDULE_ASSISTANT_COMMAND/)
assert.doesNotMatch(source, /console\.log\([^\n]*employeeName/)
assert.doesNotMatch(source, /console\.log\([^\n]*shifts/)

console.log('Schedule build bridge source tests passed')
