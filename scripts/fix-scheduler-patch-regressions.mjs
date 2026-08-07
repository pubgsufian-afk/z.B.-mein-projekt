import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'tests/e2e/unified-portal.spec.mjs'
let browserSource = await readFile(appPath, 'utf8')
const schedulerStart = browserSource.indexOf("test('scheduler edits only the schedule without reports or exports'")
const employeeStart = browserSource.indexOf("test('employee sees only clock and own published schedule'", schedulerStart)
assert.ok(schedulerStart >= 0 && employeeStart > schedulerStart, 'Scheduler-Browsertest wurde nicht gefunden.')
const beforeScheduler = browserSource.slice(0, schedulerStart)
let schedulerBlock = browserSource.slice(schedulerStart, employeeStart)
const afterScheduler = browserSource.slice(employeeStart)
const genericHeading = "await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toBeVisible()"
const uniqueHeading = "await expect(page.getByRole('heading', { exact: true, name: 'Dienst erstellen' })).toBeVisible()"
if (!schedulerBlock.includes(uniqueHeading)) {
  assert.ok(schedulerBlock.includes(genericHeading), 'Dienstplan-Support-Editorprüfung wurde nicht gefunden.')
  schedulerBlock = schedulerBlock.replace(genericHeading, uniqueHeading)
}
browserSource = beforeScheduler + schedulerBlock + afterScheduler
await writeFile(appPath, browserSource)

const preparationPath = 'scripts/prepare-unified-e2e.mjs'
let preparationSource = await readFile(preparationPath, 'utf8')
const strictHelper = "function replaceOnce(before, after, label) {\n  const count = source.split(before).length - 1"
const idempotentHelper = "function replaceOnce(before, after, label) {\n  if (source.includes(after)) return\n  const count = source.split(before).length - 1"
if (!preparationSource.includes(idempotentHelper)) {
  assert.ok(preparationSource.includes(strictHelper), 'Browser-Vorbereitungsfunktion wurde nicht gefunden.')
  preparationSource = preparationSource.replace(strictHelper, idempotentHelper)
  await writeFile(preparationPath, preparationSource)
}

for (const path of ['netlify/functions/schedule-v2.mts', 'netlify/functions/schedule-assist-v2.mts']) {
  let source = await readFile(path, 'utf8')
  const legacyGate = "if (!MANAGEMENT.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)"
  const schedulerGate = "if (!SCHEDULING.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)"
  if (source.includes(legacyGate)) {
    source = source.split(legacyGate).join(schedulerGate)
    await writeFile(path, source)
  }
}

console.log('Scheduler patch regressions fixed')
