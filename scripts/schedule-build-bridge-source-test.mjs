import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const workerPatch = await readFile('scripts/apply-schedule-command-worker.mjs', 'utf8')
const workflow = await readFile('.github/workflows/schedule-oidc-publish.yml', 'utf8')

assert.doesNotMatch(String(packageJson.scripts?.build || ''), /process-schedule-command-build\.mjs/)
assert.doesNotMatch(workerPatch, /Netlify\.env\.get\('SCHEDULE_ASSISTANT_BRIDGE_TOKEN'\)/)
assert.doesNotMatch(workerPatch, /bridgeToken/)
assert.match(workerPatch, /SCHEDULE_ASSISTANT_TOKEN/)
assert.match(workerPatch, /action === 'sync-directory'/)
assert.match(workflow, /id-token:\s*write/)
assert.match(workflow, /node scripts\/run-schedule-oidc-relay\.mjs/)

console.log('Legacy schedule build relay is disabled')
