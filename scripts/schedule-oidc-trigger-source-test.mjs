import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-oidc-trigger.mts', 'utf8')

assert.match(source, /verifyScheduleGithubOidc/)
assert.match(source, /decryptScheduleCommandEnvelopeRuntime/)
assert.match(source, /parseScheduleCommand/)
assert.match(source, /SCHEDULE_COMMAND_PRIVATE_KEY_DER_B64/)
assert.doesNotMatch(source, /SCHEDULE_COMMAND_PRIVATE_KEY_B64/)
assert.match(source, /SCHEDULE_ASSISTANT_TOKEN/)
assert.match(source, /Netlify\.env\.get/)
assert.match(source, /scheduleAssistant/)
assert.match(source, /Authorization:\s*`Bearer \$\{assistantToken\}`/)
assert.match(source, /path:\s*['"]\/api\/schedule-oidc-trigger['"]/)
assert.match(source, /request\.method !== ['"]POST['"]/)
assert.match(source, /publishedCount/)
assert.match(source, /duplicateCount/)
assert.match(source, /rejectedCount/)
assert.match(source, /results:\s*results\.map/)
const verifyCall = source.indexOf("await verifyScheduleGithubOidc(String(body.oidcToken || ''))")
const decryptCall = source.indexOf('command = decryptScheduleCommandEnvelopeRuntime(body.envelope, privateKeyDer)')
assert.ok(verifyCall >= 0, 'OIDC verification call must exist')
assert.ok(decryptCall >= 0, 'Encrypted envelope DER decryption call must exist')
assert.ok(
  verifyCall < decryptCall,
  'OIDC must be verified before the encrypted envelope is decrypted',
)
assert.doesNotMatch(source, /Access-Control-Allow-Origin/)
assert.doesNotMatch(source, /database\.pool\.query/)
assert.doesNotMatch(source, /attendance/i)
assert.doesNotMatch(source, /registrations/i)
assert.doesNotMatch(source, /role-management/i)
assert.doesNotMatch(source, /SCHEDULE_ASSISTANT_BRIDGE_TOKEN/)

console.log('Schedule OIDC trigger source tests passed')
