import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [commandCore, trigger, capabilities] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-command-core.mts', 'utf8'),
  readFile('netlify/functions/schedule-oidc-trigger.mts', 'utf8'),
  readFile('ops/portal-admin-capabilities.json', 'utf8'),
])

for (const domain of ['employees', 'registrations', 'worksites', 'company']) {
  assert.ok(commandCore.includes(`| '${domain}'`) || commandCore.includes(`'${domain}'`), `missing command domain ${domain}`)
  assert.ok(capabilities.includes(`\"domain\": \"${domain}\"`), `missing capability domain ${domain}`)
}

for (const handler of [
  'createEmployeePortalAdminHandler',
  'createRegistrationsPortalAdminHandler',
  'createWorksitePortalAdminHandler',
  'createCompanyPortalAdminHandler',
]) assert.ok(trigger.includes(handler), `missing trigger handler ${handler}`)

assert.match(trigger, /employees:\s*createEmployeePortalAdminHandler\(\)/)
assert.match(trigger, /registrations:\s*createRegistrationsPortalAdminHandler\('owner'\)/)
assert.match(trigger, /worksites:\s*createWorksitePortalAdminHandler\(\)/)
assert.match(trigger, /company:\s*createCompanyPortalAdminHandler\('owner'\)/)
assert.doesNotMatch(trigger, /database\.pool\.query|\bneon\(|getStore\(/)

console.log('portal admin domain integration tests passed')
