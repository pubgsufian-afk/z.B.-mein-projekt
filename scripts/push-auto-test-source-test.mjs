import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [client, api, core] = await Promise.all([
  readFile('frontend/src/push-notifications.js', 'utf8'),
  readFile('netlify/functions/push.mts', 'utf8'),
  readFile('netlify/functions/_shared/push-core.mts', 'utf8'),
])

assert.match(client, /action:\s*'test'/, 'client must request an automatic push test after permission is granted')
assert.match(client, /await syncDeviceToken\(registration, deviceToken\)[\s\S]*if \(requestPermission\)/, 'device token must be synchronized before the test request')
assert.match(api, /action === 'test'/, 'push API must expose an authenticated test action')
assert.match(api, /sendDeviceTestPush\(actor, token\)/, 'test action must target the current user device token')
assert.match(core, /export async function sendDeviceTestPush/, 'push core must provide per-device test delivery')
assert.match(core, /device\.userId !== actor\.userId/, 'test delivery must reject device tokens owned by another user')
assert.match(core, /Benachrichtigungen funktionieren auf diesem Gerät\./, 'test notification text must be explicit')

console.log('push automatic test source contract: ok')
