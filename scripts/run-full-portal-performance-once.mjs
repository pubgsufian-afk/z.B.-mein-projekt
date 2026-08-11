import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
const timesheetPath = 'frontend/src/TimesheetPage.jsx'
let app = await readFile(appPath, 'utf8')
let timesheet = await readFile(timesheetPath, 'utf8')
let appChanged = false

const appPerformanceActive =
  app.includes('function DigitalClock() {') &&
  app.includes("dedupeInflightJson('/api/attendance?resource=state'") &&
  app.includes('const entriesByDate = useMemo') &&
  app.includes("const OBJECTS_CACHE_KEY = '/api/schedule-v2?resource=objects'")

if (appPerformanceActive) {
  const worksiteSaveNotice = "      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })"
  const worksiteSaveWithInvalidation = "      invalidateCachedJson(OBJECTS_CACHE_KEY)\n      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })"
  if (!app.includes(worksiteSaveWithInvalidation)) {
    assert.ok(app.includes(worksiteSaveNotice), 'Einsatzort-Speicherpfad fehlt beim Wiederherstellen der Cache-Invalidierung.')
    app = app.replace(worksiteSaveNotice, worksiteSaveWithInvalidation)
    appChanged = true
  }

  const worksiteDeleteReset = "      if (form.id === object.id) resetForm()"
  const worksiteDeleteWithInvalidation = "      invalidateCachedJson(OBJECTS_CACHE_KEY)\n      if (form.id === object.id) resetForm()"
  if (!app.includes(worksiteDeleteWithInvalidation)) {
    assert.ok(app.includes(worksiteDeleteReset), 'Einsatzort-Löschpfad fehlt beim Wiederherstellen der Cache-Invalidierung.')
    app = app.replace(worksiteDeleteReset, worksiteDeleteWithInvalidation)
    appChanged = true
  }

  if (appChanged) await writeFile(appPath, app)

  const legacyHistory = "      const data = await requestJson(`/api/attendance?${params}`)"
  const optimizedHistory = "      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"

  if (!timesheet.includes(optimizedHistory)) {
    assert.ok(timesheet.includes(legacyHistory), 'Stundenzettel-Historienrequest fehlt beim Wiederherstellen der Performance-Schicht.')
    assert.ok(timesheet.includes("      const historyTo = addDateDays(to, 1)"), 'Stundenzettel-Nachtschichtlogik fehlt beim Wiederherstellen der Performance-Schicht.')
    timesheet = timesheet.replace(legacyHistory, optimizedHistory)
    await writeFile(timesheetPath, timesheet)
  }

  console.log(appChanged || !timesheet.includes(legacyHistory) ? 'Full portal performance layer retained and final cache rules restored' : 'Full portal performance layer already applied')
} else {
  await import('./apply-full-portal-performance.mjs')
}
