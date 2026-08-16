import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [client, api, core] = await Promise.all([
  readFile('frontend/src/push-notifications.js', 'utf8'),
  readFile('netlify/functions/push.mts', 'utf8'),
  readFile('netlify/functions/_shared/push-core.mts', 'utf8'),
])

assert.doesNotMatch(client, /mountAdminSender/, 'manual push sender UI must be removed')
assert.doesNotMatch(client, /data-habun-push-admin/, 'manual push bell must be removed')
assert.doesNotMatch(api, /action === ['"]send['"]/, 'manual send API action must be removed')
assert.doesNotMatch(api, /sendPortalPush/, 'manual send API must not import broadcast sender')
assert.doesNotMatch(core, /export async function sendPortalPush/, 'manual broadcast primitive must be removed')
assert.match(core, /export async function sendPushToUsers/, 'server-side targeted push primitive must exist')
assert.match(core, /userIds:\s*string\[\]/, 'targeted push must require explicit user ids')

console.log('automatic schedule push red contract: ok')
