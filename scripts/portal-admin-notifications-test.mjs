import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [company, adapter] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-company.mts', 'utf8'),
  readFile('netlify/functions/_shared/push-admin-send.mts', 'utf8'),
])

assert.match(company, /sendAdminPortalPush/)
assert.match(company, /operation\.action === 'send-notification'/)
assert.match(company, /targetUserId/)
assert.doesNotMatch(company, /registerPushDevice|unregisterPushDevice|sendDeviceTestPush/)
assert.match(adapter, /sendPushToUsers/)
assert.match(adapter, /sendPortalPush/)
assert.match(adapter, /targetUserId/)
console.log('portal admin notification tests passed')
