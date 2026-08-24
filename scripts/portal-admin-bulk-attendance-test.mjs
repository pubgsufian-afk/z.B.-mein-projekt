import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [assistant, adapter, capabilities] = await Promise.all([
  readFile('netlify/functions/attendance-assistant.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-attendance.mts', 'utf8'),
  readFile('ops/portal-admin-capabilities.json', 'utf8'),
])

for (const needle of [
  'bulk-update-attendance-sessions',
  'create-attendance-session',
  'updates.slice(0, 100)',
  'attendanceAdminService().updateSession',
  'attendanceAdminService().createSession',
]) assert.ok(assistant.includes(needle), `missing ${needle}`)

assert.match(adapter, /\['bulk-update-sessions', 'bulk-update-attendance-sessions'\]/)
assert.match(adapter, /\['create-session', 'create-attendance-session'\]/)
assert.match(capabilities, /"attendance\.bulk-update-sessions"/)
assert.match(capabilities, /"attendance\.create-session"/)
assert.ok(!assistant.includes('Promise.all(updates'), 'mutations must preserve deterministic order')

console.log('portal admin bulk attendance tests passed')
