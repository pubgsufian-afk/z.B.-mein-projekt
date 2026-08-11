import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
const timesheetPath = 'frontend/src/TimesheetPage.jsx'
const app = await readFile(appPath, 'utf8')
let timesheet = await readFile(timesheetPath, 'utf8')

const appPerformanceActive =
  app.includes('function DigitalClock() {') &&
  app.includes("dedupeInflightJson('/api/attendance?resource=state'") &&
  app.includes('const entriesByDate = useMemo') &&
  app.includes("const OBJECTS_CACHE_KEY = '/api/schedule-v2?resource=objects'")

if (appPerformanceActive) {
  const legacyHistory = "      const data = await requestJson(`/api/attendance?${params}`)"
  const optimizedHistory = "      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"

  if (!timesheet.includes(optimizedHistory)) {
    assert.ok(timesheet.includes(legacyHistory), 'Stundenzettel-Historienrequest fehlt beim Wiederherstellen der Performance-Schicht.')
    assert.ok(timesheet.includes("      const historyTo = addDateDays(to, 1)"), 'Stundenzettel-Nachtschichtlogik fehlt beim Wiederherstellen der Performance-Schicht.')
    timesheet = timesheet.replace(legacyHistory, optimizedHistory)
    await writeFile(timesheetPath, timesheet)
    console.log('Full portal performance layer retained; timesheet history dedupe restored')
  } else {
    console.log('Full portal performance layer already applied')
  }
} else {
  await import('./apply-full-portal-performance.mjs')
}
