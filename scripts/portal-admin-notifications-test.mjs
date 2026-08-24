import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const company = await readFile('netlify/functions/_shared/portal-admin-company.mts', 'utf8')
const core = await readFile('netlify/functions/_shared/push-core.mts', 'utf8')

assert.match(company, /sendPortalPush/)
assert.match(company, /operation\.action === 'send-notification'/)
assert.match(company, /targetUserId/)
assert.match(company, /actorRole: 'owner'/)
assert.doesNotMatch(company, /registerPushDevice|unregisterPushDevice|sendDeviceTestPush/)
assert.match(core, /export async function sendPortalPush/)
console.log('portal admin notification tests passed')
