import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-command-worker.mts', 'utf8')

assert.match(source, /SCHEDULE_ASSISTANT_COMMAND_RUNTIME/)
assert.match(source, /SCHEDULE_ASSISTANT_TOKEN/)
assert.match(source, /parseScheduleCommand/)
assert.match(source, /getStore\(\{ name: 'schedule-command-worker'/)
assert.match(source, /processed\//)
assert.match(source, /scheduleAssistant/)
assert.match(source, /requestId:\s*command\.commandId/)
assert.match(source, /schedule-command-worker state store unavailable/)
assert.match(source, /schedule-command-worker could not persist processed marker/)
assert.match(source, /schedule:\s*['"]\* \* \* \* \*['"]/)
assert.doesNotMatch(source, /Access-Control-Allow-Origin/)
assert.doesNotMatch(source, /database\.pool\.query/)

console.log('Schedule command worker source tests passed')
