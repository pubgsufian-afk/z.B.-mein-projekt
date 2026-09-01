import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const schedulePath = 'netlify/functions/schedule-v2-neon.mts'
let schedule = await readFile(schedulePath, 'utf8')

if (!schedule.includes("from './_shared/schedule-assistant-core.mts'")) {
  const anchor = "import { currentPortalActor } from './_shared/portal-role.mts'"
  assert.ok(schedule.includes(anchor), 'Portal-Rollen-Import wurde nicht gefunden.')
  schedule = schedule.replace(
    anchor,
    `${anchor}\nimport { classifyAssistantDuplicate } from './_shared/schedule-assistant-core.mts'\nimport { ensureLegacyScheduleMigrated as ensureSharedLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'`,
  )
} else if (!schedule.includes('classifyAssistantDuplicate')) {
  const anchor = "import { currentPortalActor } from './_shared/portal-role.mts'"
  schedule = schedule.replace(
    anchor,
    `${anchor}\nimport { classifyAssistantDuplicate } from './_shared/schedule-assistant-core.mts'\nimport { ensureLegacyScheduleMigrated as ensureSharedLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'`,
  )
}

if (!schedule.includes('ensureSharedLegacyScheduleMigrated')) {
  const anchor = "import { currentPortalActor } from './_shared/portal-role.mts'"
  assert.ok(schedule.includes(anchor), 'Shared-Bootstrap-Import konnte nicht eingefügt werden.')
  schedule = schedule.replace(
    anchor,
    `${anchor}\nimport { ensureLegacyScheduleMigrated as ensureSharedLegacyScheduleMigrated } from './_shared/schedule-legacy-bootstrap.mts'`,
  )
}

schedule = schedule.replace('await ensureLegacyScheduleMigrated()', 'await ensureSharedLegacyScheduleMigrated()')

if (!schedule.includes('classifyAssistantDuplicate(candidate, dateShifts, activeEmployees)')) {
  const oldBlock = `  if (await findExactScheduleDuplicate(candidate, candidate.id)) {\n    return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE' }, 409)\n  }\n  const overlaps = await listScheduleOverlaps(candidate, candidate.id)`
  assert.ok(schedule.includes(oldBlock), 'Alter Duplikatblock im Portal-Dienstplan wurde nicht gefunden.')
  const newBlock = `  const activeEmployees = await listActiveScheduleEmployees()\n  const dateShifts = (await listScheduleShifts({ from: candidate.date, to: candidate.date }))\n    .filter((entry) => entry.id !== candidate.id)\n  const classifiedDuplicate = classifyAssistantDuplicate(candidate, dateShifts, activeEmployees)\n  if (classifiedDuplicate.exact) {\n    return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE', shiftId: classifiedDuplicate.exact.id }, 409)\n  }\n  if (classifiedDuplicate.time) {\n    return json({ message: 'Für diesen Mitarbeiter existiert zur selben Zeit bereits ein Dienst.', code: 'TIME_DUPLICATE', shiftId: classifiedDuplicate.time.id }, 409)\n  }\n  const overlaps = classifiedDuplicate.overlaps`
  schedule = schedule.replace(oldBlock, newBlock)
}

assert.match(schedule, /ensureSharedLegacyScheduleMigrated/)
assert.match(schedule, /classifyAssistantDuplicate\(candidate, dateShifts, activeEmployees\)/)
assert.match(schedule, /TIME_DUPLICATE/)

await writeFile(schedulePath, schedule)
console.log('Schedule assistant full-control portal patch applied')

await import('./ensure-settings-performance-input.mjs')
await import('./apply-schedule-publish-user-id.mjs')
await import('./apply-schedule-safe-relay-approvals.mjs')