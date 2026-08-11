import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
const timesheetPath = 'frontend/src/TimesheetPage.jsx'
let app = await readFile(appPath, 'utf8')
let timesheet = await readFile(timesheetPath, 'utf8')
let appChanged = false

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `${label} wurde nicht gefunden.`)
  return { start, end, block: source.slice(start, end) }
}

const appPerformanceActive =
  app.includes('function DigitalClock() {') &&
  app.includes("dedupeInflightJson('/api/attendance?resource=state'") &&
  app.includes('const entriesByDate = useMemo') &&
  app.includes("const OBJECTS_CACHE_KEY = '/api/schedule-v2?resource=objects'")

if (appPerformanceActive) {
  {
    const { start, end, block: original } = section(app, 'function WorksitesPage() {', '\nfunction CorrectionsPage', 'WorksitesPage')
    let block = original
    if (!block.includes('const cached = peekCachedJson(OBJECTS_CACHE_KEY)')) {
      const oldLoad = "  const load = useCallback(async () => { try { const data = await apiJson('/api/schedule-v2?resource=objects'); setObjects(data.objects || []) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])"
      const newLoad = "  const load = useCallback(async () => {\n    try {\n      const cached = peekCachedJson(OBJECTS_CACHE_KEY)\n      if (cached !== undefined) setObjects(cached.objects || [])\n      const data = await refreshCachedJson(OBJECTS_CACHE_KEY, () => apiJson(OBJECTS_CACHE_KEY), { ttlMs: OBJECTS_CACHE_TTL_MS })\n      setObjects(data.objects || [])\n    } catch (error) { setNotice({ tone: 'error', text: error.message }) }\n  }, [])"
      assert.ok(block.includes(oldLoad), 'Einsatzort-Ladung fehlt beim Wiederherstellen der cached-then-fresh-Logik.')
      block = block.replace(oldLoad, newLoad)
    }

    const worksiteSaveNotice = "      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })"
    const worksiteSaveWithInvalidation = "      invalidateCachedJson(OBJECTS_CACHE_KEY)\n      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })"
    if (!block.includes(worksiteSaveWithInvalidation)) {
      assert.ok(block.includes(worksiteSaveNotice), 'Einsatzort-Speicherpfad fehlt beim Wiederherstellen der Cache-Invalidierung.')
      block = block.replace(worksiteSaveNotice, worksiteSaveWithInvalidation)
    }

    const worksiteDeleteReset = "      if (form.id === object.id) resetForm()"
    const worksiteDeleteWithInvalidation = "      invalidateCachedJson(OBJECTS_CACHE_KEY)\n      if (form.id === object.id) resetForm()"
    if (!block.includes(worksiteDeleteWithInvalidation)) {
      assert.ok(block.includes(worksiteDeleteReset), 'Einsatzort-Löschpfad fehlt beim Wiederherstellen der Cache-Invalidierung.')
      block = block.replace(worksiteDeleteReset, worksiteDeleteWithInvalidation)
    }

    if (block !== original) {
      app = app.slice(0, start) + block + app.slice(end)
      appChanged = true
    }
  }

  {
    const { start, end, block: original } = section(app, 'function ReportsPage() {', '\nfunction SettingsPage', 'ReportsPage')
    let block = original
    if (!block.includes('peekCachedJson(REGISTRATIONS_CACHE_KEY)')) {
      const oldEffect = "  useEffect(() => { apiJson('/api/registrations').then((data) => setEmployees(data.employees || [])).catch((error) => setNotice({ tone: 'error', text: error.message })) }, [])"
      const newEffect = "  useEffect(() => {\n    let active = true\n    const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)\n    if (cached !== undefined) setEmployees(cached.employees || [])\n    refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson('/api/registrations'), { ttlMs: REGISTRATIONS_CACHE_TTL_MS })\n      .then((data) => { if (active) setEmployees(data.employees || []) })\n      .catch((error) => { if (active) setNotice({ tone: 'error', text: error.message }) })\n    return () => { active = false }\n  }, [])"
      assert.ok(block.includes(oldEffect), 'Berichte-Mitarbeiterladung fehlt beim Wiederherstellen der Performance-Schicht.')
      block = block.replace(oldEffect, newEffect)
      app = app.slice(0, start) + block + app.slice(end)
      appChanged = true
    }
  }

  {
    const { start, end, block: original } = section(app, 'function SettingsPage({ session }) {', '\n\nfunction UnifiedPortal', 'SettingsPage')
    let block = original
    if (!block.includes('peekCachedJson(COMPANY_SETTINGS_CACHE_KEY)')) {
      const oldLoad = `  const load = useCallback(async () => {\n    try {\n      const data = await apiJson('/api/company-settings')\n      setForm((current) => ({ ...current, ...(data.settings || {}) }))\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [])`
      const newLoad = `  const load = useCallback(async () => {\n    try {\n      const cached = peekCachedJson(COMPANY_SETTINGS_CACHE_KEY)\n      if (cached !== undefined) setForm((current) => ({ ...current, ...(cached.settings || {}) }))\n      const data = await refreshCachedJson(COMPANY_SETTINGS_CACHE_KEY, () => apiJson('/api/company-settings'), { ttlMs: COMPANY_SETTINGS_CACHE_TTL_MS })\n      setForm((current) => ({ ...current, ...(data.settings || {}) }))\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [])`
      assert.ok(block.includes(oldLoad), 'Einstellungen-Ladung fehlt beim Wiederherstellen der Performance-Schicht.')
      block = block.replace(oldLoad, newLoad)
    }

    const setFormLine = "      setForm((current) => ({ ...current, ...data.settings }))"
    const invalidateAndSet = "      invalidateCachedJson(COMPANY_SETTINGS_CACHE_KEY)\n      setForm((current) => ({ ...current, ...data.settings }))"
    if (!block.includes('invalidateCachedJson(COMPANY_SETTINGS_CACHE_KEY)')) {
      const count = block.split(setFormLine).length - 1
      assert.ok(count >= 1, 'Einstellungen-Schreibpfad fehlt beim Wiederherstellen der Cache-Invalidierung.')
      block = block.split(setFormLine).join(invalidateAndSet)
    }

    if (block !== original) {
      app = app.slice(0, start) + block + app.slice(end)
      appChanged = true
    }
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

  console.log('Full portal performance layer retained and final cache rules restored')
} else {
  await import('./apply-full-portal-performance.mjs')
}
