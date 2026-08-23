import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const workflow = await readFile('.github/workflows/schedule-oidc-publish.yml', 'utf8')
const relay = await readFile('scripts/run-schedule-oidc-relay.mjs', 'utf8')

assert.match(workflow, /^name:\s*Habun schedule OIDC relay/m)
assert.match(workflow, /issue_comment:/)
assert.match(workflow, /types:\s*\[[^\]]*created[^\]]*\]/)
assert.doesNotMatch(workflow, /pull_request:/)
assert.doesNotMatch(workflow, /\bpush:/)
assert.match(workflow, /github\.event\.issue\.pull_request/)
assert.match(workflow, /github\.event\.issue\.number\s*==\s*73/)
assert.match(workflow, /github\.event\.sender\.id\s*==\s*249184348/)
assert.doesNotMatch(workflow, /github\.actor_id/)
assert.match(workflow, /startsWith\(github\.event\.comment\.body,\s*['"]<!-- habun-schedule-envelope-v1 -->['"]\)/)
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read\s*\n\s*id-token:\s*write/m)
assert.doesNotMatch(workflow, /issues:\s*write/i)
assert.doesNotMatch(workflow, /contents:\s*write/i)
assert.match(workflow, /ref:\s*main/)
assert.match(workflow, /node scripts\/run-schedule-oidc-relay\.mjs/)
assert.match(workflow, /SCHEDULE_ENVELOPE_COMMENT:/)
assert.match(workflow, /SCHEDULE_ENCRYPTED_RESULT_PATH:/)
assert.match(workflow, /github\.event\.comment\.body/)
assert.match(workflow, /actions\/upload-artifact@v4/)
assert.match(workflow, /name:\s*habun-schedule-encrypted-result/)
assert.match(workflow, /retention-days:\s*1/)
assert.match(workflow, /if-no-files-found:\s*ignore/)
assert.doesNotMatch(workflow, /secrets\./i)
assert.doesNotMatch(workflow, /DATABASE_URL|NETLIFY_DATABASE_URL|NEON_DATABASE_URL/i)

assert.match(relay, /ACTIONS_ID_TOKEN_REQUEST_URL/)
assert.match(relay, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/)
assert.match(relay, /const OIDC_AUDIENCE = ['"]habun-schedule-assistant['"]/)
assert.match(relay, /SCHEDULE_ENVELOPE_COMMENT/)
assert.match(relay, /SCHEDULE_ENCRYPTED_RESULT_PATH/)
assert.match(relay, /writeFile/)
assert.match(relay, /safeEncryptedResult/)
assert.match(relay, /safeRelayError/)
assert.match(relay, /await relayResponse\.json\(\)\.catch/)
assert.match(relay, /relayError\.message/)
assert.doesNotMatch(relay, /HABUN_SCHEDULE_ENCRYPTED_RESULT_V1=/)
assert.doesNotMatch(relay, /SCHEDULE_ENVELOPE_REF/)
assert.doesNotMatch(relay, /GITHUB_REPOSITORY_NAME/)
assert.doesNotMatch(relay, /GITHUB_RELAY_TOKEN/)
assert.doesNotMatch(relay, /ops\/schedule-command\.envelope\.json/)
assert.doesNotMatch(relay, /api\.github\.com\/repos/)
assert.match(relay, /https:\/\/habun-mitarbeiterportal\.netlify\.app\/api\/schedule-oidc-trigger/)
assert.doesNotMatch(relay, /issues\/comments/)
assert.match(relay, /publishedCount/)
assert.match(relay, /duplicateCount/)
assert.match(relay, /rejectedCount/)
assert.match(relay, /directoryDiagnostics/)
assert.doesNotMatch(relay, /SCHEDULE_ASSISTANT_TOKEN/)
assert.doesNotMatch(relay, /SCHEDULE_ASSISTANT_BRIDGE_TOKEN/)
assert.doesNotMatch(relay, /SCHEDULE_COMMAND_PRIVATE_KEY_B64/)
assert.doesNotMatch(relay, /console\.log\([^\n]*(oidcToken|envelope|responseBody|employeeName|email|GITHUB_RELAY_TOKEN|encryptedResult)/i)

const invalidMarker = 'private-schedule-comment-must-not-be-logged'
const invalidResult = spawnSync(process.execPath, ['scripts/run-schedule-oidc-relay.mjs'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    SCHEDULE_ENVELOPE_COMMENT: invalidMarker,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'http://127.0.0.1:1/oidc',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-token',
  },
})
assert.notEqual(invalidResult.status, 0)
assert.match(invalidResult.stderr, /Ungültiger Dienstplan-Envelope-Marker/)
assert.doesNotMatch(`${invalidResult.stdout}\n${invalidResult.stderr}`, new RegExp(invalidMarker))

console.log('Schedule OIDC workflow source tests passed')
