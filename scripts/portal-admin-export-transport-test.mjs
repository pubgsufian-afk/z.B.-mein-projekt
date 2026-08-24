import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [trigger, runner, workflow] = await Promise.all([
  readFile('netlify/functions/schedule-oidc-trigger.mts', 'utf8'),
  readFile('scripts/run-schedule-oidc-relay.mjs', 'utf8'),
  readFile('.github/workflows/schedule-oidc-publish.yml', 'utf8'),
])

for (const needle of [
  'consumePortalAdminExport',
  'createReportsPortalAdminHandler',
  'body.exportHandle',
  'exports: publicExports',
]) assert.ok(trigger.includes(needle), `missing trigger export marker ${needle}`)
assert.ok(trigger.indexOf('await verifyScheduleGithubOidc') < trigger.indexOf('body.exportHandle'), 'OIDC must be verified before export consumption')

for (const needle of [
  'result?.exports',
  'PORTAL_ADMIN_EXPORT_DIR',
  'exportHandle',
  'writeFile',
]) assert.ok(runner.includes(needle), `missing runner export marker ${needle}`)
assert.doesNotMatch(runner, /console\.log\([^\n]*(ciphertext|responseKey)/i)

assert.match(workflow, /habun-portal-admin-exports/)
assert.match(workflow, /PORTAL_ADMIN_EXPORT_DIR/)

console.log('portal admin export transport tests passed')
