import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [repository, assistant, neonPatch] = await Promise.all([
  readFile('netlify/functions/_shared/schedule-neon-repository.mts', 'utf8'),
  readFile('netlify/functions/schedule-assistant.mts', 'utf8'),
  readFile('scripts/apply-neon-schedule-source.mjs', 'utf8'),
])

assert.match(repository, /export async function listProvisionalScheduleEmployees/)
assert.match(repository, /employee_user_id LIKE 'guest:%'/)
assert.match(repository, /export async function rebindProvisionalEmployeeIdentity/)
assert.match(repository, /await client\.query\('BEGIN'\)/)
assert.match(repository, /UPDATE schedule_shifts[\s\S]*employee_user_id = \$2[\s\S]*employee_name = \$3/)
assert.match(repository, /UPDATE timesheet_entries[\s\S]*employee_user_id = \$2[\s\S]*employee_name = \$3/)
assert.match(repository, /schedule_shifts_exact_duplicate_idx|lower\(btrim\(existing\.location\)\)/)
assert.match(repository, /action[^\n]*provisional-employee-rebound|provisional-employee-rebound/)
assert.match(repository, /await client\.query\('COMMIT'\)/)
assert.match(repository, /await client\.query\('ROLLBACK'\)/)

assert.match(assistant, /provisionalRebindCandidates/)
assert.match(assistant, /listProvisionalScheduleEmployees/)
assert.match(assistant, /rebindProvisionalEmployeeIdentity/)
assert.match(assistant, /async function reconcileProvisionalEmployees/)
const syncStart = assistant.indexOf("if (action === 'sync-directory')")
const publishStart = assistant.indexOf("if (action === 'publish-shifts')")
assert.ok(syncStart >= 0 && publishStart > syncStart)
assert.match(assistant.slice(syncStart, publishStart), /await reconcileProvisionalEmployees\(employees\)/)
assert.match(assistant.slice(publishStart), /await reconcileProvisionalEmployees\(employees\)/)
const actionIndex = assistant.indexOf('const action = text(body.action)')
const reconcileFunctionCallBeforeAction = assistant.slice(0, actionIndex).match(/await reconcileProvisionalEmployees\(employees\)/)
assert.equal(reconcileFunctionCallBeforeAction, null, 'read paths must not trigger provisional reconciliation')

assert.match(neonPatch, /employee_user_id NOT LIKE 'guest:%'/, 'legacy stale-id rebind must not consume guest identities')

console.log('Schedule provisional reconciliation source tests passed')
