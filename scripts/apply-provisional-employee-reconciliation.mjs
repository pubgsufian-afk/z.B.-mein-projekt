import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/schedule-assistant.mts'
let source = await readFile(path, 'utf8')

if (!source.includes("from './_shared/schedule-provisional-reconciliation.mts'")) {
  const anchor = "import { ensureLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'\n"
  assert.ok(source.includes(anchor), 'Reconciliation import anchor missing')
  source = source.replace(
    anchor,
    `${anchor}import { provisionalRebindCandidates } from './_shared/schedule-provisional-reconciliation.mts'\nimport { listProvisionalScheduleEmployees, rebindProvisionalEmployeeIdentity } from './_shared/schedule-neon-repository.mts'\n`,
  )
}

if (!source.includes('async function reconcileProvisionalEmployees(')) {
  const anchor = 'async function activePortalWorksites(): Promise<AssistantWorksite[]> {'
  assert.ok(source.includes(anchor), 'Reconciliation helper anchor missing')
  const helper = `async function reconcileProvisionalEmployees(employees: AssistantDirectoryEmployee[]) {\n  const guests = await listProvisionalScheduleEmployees()\n  const candidates = provisionalRebindCandidates(guests, employees)\n  const results = []\n  for (const candidate of candidates) {\n    results.push(await rebindProvisionalEmployeeIdentity({\n      ...candidate,\n      actorId: ACTOR_ID,\n    }))\n  }\n  return results\n}\n\n`
  source = source.replace(anchor, `${helper}${anchor}`)
}

if (!source.includes("if (action === 'sync-directory') {\n      await reconcileProvisionalEmployees(employees)")) {
  const anchor = "    if (action === 'sync-directory') {\n"
  assert.ok(source.includes(anchor), 'sync-directory reconciliation anchor missing')
  source = source.replace(anchor, `${anchor}      await reconcileProvisionalEmployees(employees)\n`)
}

if (!source.includes("if (action === 'publish-shifts') {\n      await reconcileProvisionalEmployees(employees)")) {
  const anchor = "    if (action === 'publish-shifts') {\n"
  assert.ok(source.includes(anchor), 'publish-shifts reconciliation anchor missing')
  source = source.replace(anchor, `${anchor}      await reconcileProvisionalEmployees(employees)\n`)
}

if (!source.includes('PROVISIONAL_EMPLOYEE_RECONCILIATION_APPLIED')) {
  source += '\n// PROVISIONAL_EMPLOYEE_RECONCILIATION_APPLIED\n'
}

await writeFile(path, source)
console.log('Provisional employee reconciliation applied')
