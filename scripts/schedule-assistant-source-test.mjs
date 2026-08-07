import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-assistant.mts', 'utf8')

assert.match(source, /SCHEDULE_ASSISTANT_TOKEN/)
assert.match(source, /Authorization/i)
assert.match(source, /timingSafeEqual/)
assert.match(source, /getStore\(\{ name: 'portal-access'/)
assert.match(source, /resolveAssistantEmployee/)
assert.match(source, /validateAssistantShiftInput/)
assert.match(source, /syncScheduleEmployees/)
assert.match(source, /findExactScheduleDuplicate/)
assert.match(source, /listScheduleOverlaps/)
assert.match(source, /upsertScheduleShift/)
assert.match(source, /writeScheduleAudit/)
assert.match(source, /action === 'resolve-employees'/)
assert.match(source, /action === 'publish-shifts'/)
assert.match(source, /actorId: 'dienstplan-assistent'/)
assert.match(source, /source: 'chatgpt'/)
assert.match(source, /status: 'published'/)
assert.match(source, /path: '\/api\/schedule-assistant'/)
assert.match(source, /request\.method !== 'POST'/)
assert.doesNotMatch(source, /Access-Control-Allow-Origin/)
assert.doesNotMatch(source, /database\.pool\.query/)
assert.doesNotMatch(source, /attendance|registrations/)

console.log('Schedule assistant source tests passed')
