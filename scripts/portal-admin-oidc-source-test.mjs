import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, relay] = await Promise.all([
  readFile('netlify/functions/schedule-oidc-trigger.mts', 'utf8'),
  readFile('scripts/run-schedule-oidc-relay.mjs', 'utf8'),
])

for (const needle of [
  'verifyScheduleGithubOidc',
  'decryptScheduleCommandEnvelopeRuntime',
  'parsePortalAdminCommand',
  'parseScheduleCommand',
  'createPortalAdminRouter',
  'createSchedulePortalAdminHandler',
  'createAttendancePortalAdminHandler',
  'succeededCount',
  'encryptedResult',
]) assert.ok(source.includes(needle), `missing ${needle}`)

assert.match(source, /if \(String\(command\.domain \|\| ''\)\.trim\(\)\)/)
assert.doesNotMatch(source, /database\.pool\.query|\bneon\(/)

const verifyCall = source.indexOf("await verifyScheduleGithubOidc(String(body.oidcToken || ''))")
const decryptCall = source.indexOf('command = decryptScheduleCommandEnvelopeRuntime(body.envelope, privateKeyDer)')
const portalParse = source.indexOf('parsePortalAdminCommand(JSON.stringify(command), new Date())')
const legacyParse = source.indexOf('parseScheduleCommand(JSON.stringify(command), new Date())')
assert.ok(verifyCall >= 0 && decryptCall > verifyCall)
assert.ok(portalParse > decryptCall)
assert.ok(legacyParse > decryptCall)

const publicKeyBranch = source.indexOf('const keyRequestResponseKey = publicKeyRequest(body.envelope)')
assert.ok(publicKeyBranch > verifyCall && publicKeyBranch < decryptCall)

assert.match(relay, /result\?\.succeededCount/)
assert.match(relay, /Habun portal admin OIDC relay: succeeded=/)
assert.doesNotMatch(relay, /console\.log\([^\n]*(employeeName|clockInAt|clockOutAt|responseKey|ciphertext)/i)

console.log('portal admin OIDC source tests passed')
