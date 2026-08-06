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
const scopedHeading = "await expect(page.locator('.editor-panel').getByRole('heading', { name: 'Dienst erstellen' })).toBeVisible()"
if (!schedulerBlock.includes(scopedHeading)) {
  assert.ok(schedulerBlock.includes(genericHeading), 'Dienstplan-Support-Editorprüfung wurde nicht gefunden.')
  schedulerBlock = schedulerBlock.replace(genericHeading, scopedHeading)
  browserSource = beforeScheduler + schedulerBlock + afterScheduler
  await writeFile(appPath, browserSource)
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
