import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
let changed = false

function replaceOnce(before, after, label) {
  if (app.includes(after)) return
  const count = app.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  app = app.replace(before, after)
  changed = true
}

function replaceInBlock(source, before, after, label) {
  if (source.includes(after)) return source
  const count = source.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  changed = true
  return source.replace(before, after)
}

function blockBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `${label} wurde nicht gefunden.`)
  return { start, end, block: source.slice(start, end) }
}

// Extend the existing safe in-memory cache import.
const oldCacheImport = "import { clearReadCache, invalidateCachedJson, peekCachedJson, refreshCachedJson } from './read-cache.js'\n"
const newCacheImport = "import { clearReadCache, dedupeInflightJson, invalidateCachedJson, peekCachedJson, refreshCachedJson } from './read-cache.js'\n"
if (!app.includes(newCacheImport)) {
  assert.ok(app.includes(oldCacheImport), 'Read-cache Import fehlt vor dem Full-Portal-Performance-Patch.')
  app = app.replace(oldCacheImport, newCacheImport)
  changed = true
}

const oldCacheConstants = "const REGISTRATIONS_CACHE_KEY = '/api/registrations'\nconst REGISTRATIONS_CACHE_TTL_MS = 15000\n"
const newCacheConstants = "const REGISTRATIONS_CACHE_KEY = '/api/registrations'\nconst REGISTRATIONS_CACHE_TTL_MS = 15000\nconst OBJECTS_CACHE_KEY = '/api/schedule-v2?resource=objects'\nconst OBJECTS_CACHE_TTL_MS = 30000\nconst COMPANY_SETTINGS_CACHE_KEY = '/api/company-settings'\nconst COMPANY_SETTINGS_CACHE_TTL_MS = 60000\n"
if (!app.includes('const OBJECTS_CACHE_KEY')) {
  assert.ok(app.includes(oldCacheConstants), 'Performance-Cache-Konstanten fehlen.')
  app = app.replace(oldCacheConstants, newCacheConstants)
  changed = true
}

// Reuse expensive Intl formatters across the whole App.
const oldFormatDate = `function formatDate(value, options = { dateStyle: 'medium' }) {\n  if (!value) return '–'\n  const date = new Date(value.length === 10 ? \`\${value}T12:00:00\` : value)\n  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', options).format(date) : '–'\n}`
const newFormatDate = `const DATE_FORMATTERS = new Map()\n\nfunction dateFormatter(options) {\n  const key = JSON.stringify(options || {})\n  let formatter = DATE_FORMATTERS.get(key)\n  if (!formatter) {\n    formatter = new Intl.DateTimeFormat('de-DE', options)\n    DATE_FORMATTERS.set(key, formatter)\n  }\n  return formatter\n}\n\nfunction formatDate(value, options = { dateStyle: 'medium' }) {\n  if (!value) return '–'\n  const date = new Date(value.length === 10 ? \`\${value}T12:00:00\` : value)\n  return Number.isFinite(date.getTime()) ? dateFormatter(options).format(date) : '–'\n}`
if (!app.includes('const DATE_FORMATTERS = new Map()')) replaceOnce(oldFormatDate, newFormatDate, 'Intl-Formatter-Wiederverwendung')

// Page switches should feel immediate instead of animating the whole page to the top.
replaceOnce(
  "  const navigate = (key) => { setPage(key); setDrawer(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }",
  "  const navigate = (key) => { setPage(key); setDrawer(false); window.scrollTo({ top: 0, behavior: 'auto' }) }",
  'Sofortige Seitennavigation',
)

// Keep the one-second clock rerender isolated to the clock itself.
const oldClock = `function DigitalClock({ now }) {\n  const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)\n  return <div className="digital-clock-wrap"><time className="digital-clock" dateTime={now.toISOString()}>{time}</time><span>{formatDate(now, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span></div>\n}`
const newClock = `function DigitalClock() {\n  const [now, setNow] = useState(() => new Date())\n  useEffect(() => {\n    const timer = window.setInterval(() => setNow(new Date()), 1000)\n    return () => window.clearInterval(timer)\n  }, [])\n  const time = dateFormatter({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)\n  return <div className="digital-clock-wrap"><time className="digital-clock" dateTime={now.toISOString()}>{time}</time><span>{formatDate(now, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span></div>\n}`
if (!app.includes('function DigitalClock() {')) replaceOnce(oldClock, newClock, 'Isolierte Digitaluhr')
if (app.includes("  const [now, setNow] = useState(new Date())\n")) {
  app = app.replace("  const [now, setNow] = useState(new Date())\n", '')
  changed = true
}
if (app.includes("  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])\n")) {
  app = app.replace("  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])\n", '')
  changed = true
}
if (app.includes('<DigitalClock now={now} />')) {
  app = app.replace('<DigitalClock now={now} />', '<DigitalClock />')
  changed = true
}

// Overview only needs today's schedule rows and shares concurrent dynamic reads.
{
  const { start, end, block: original } = blockBetween(app, 'function OverviewPage({ session, navigate }) {', '\nfunction DigitalClock', 'OverviewPage')
  let block = original
  const lateToday = "\n  const today = new Date().toISOString().slice(0, 10)\n  const todayShifts = schedule.filter((entry) => entry.date === today)"
  if (!block.includes("  const today = new Date().toISOString().slice(0, 10)\n\n  useEffect")) {
    block = replaceInBlock(
      block,
      "  const [notice, setNotice] = useState(null)\n\n  useEffect",
      "  const [notice, setNotice] = useState(null)\n  const today = new Date().toISOString().slice(0, 10)\n\n  useEffect",
      'Overview Heute vor Request',
    )
  }
  if (block.includes(lateToday)) {
    block = block.replace(lateToday, "\n  const todayShifts = schedule.filter((entry) => entry.date === today)")
    changed = true
  }
  const oldCalls = "        const calls = [apiJson('/api/schedule-v2?resource=entries'), apiJson('/api/attendance?resource=state')]"
  const newCalls = "        const schedulePath = `/api/schedule-v2?resource=entries&from=${today}&to=${today}`\n        const calls = [\n          dedupeInflightJson(schedulePath, () => apiJson(schedulePath)),\n          dedupeInflightJson('/api/attendance?resource=state', () => apiJson('/api/attendance?resource=state')),\n        ]"
  if (!block.includes('const schedulePath = `/api/schedule-v2?resource=entries&from=${today}&to=${today}`')) {
    block = replaceInBlock(block, oldCalls, newCalls, 'Overview Tagesbereich')
  }
  app = app.slice(0, start) + block + app.slice(end)
}

// Attendance state/live stay fresh, but concurrent identical reads are shared.
{
  const { start, end, block: original } = blockBetween(app, 'function AttendancePage({ session }) {', '\nfunction EmployeesPage', 'AttendancePage')
  let block = original
  block = replaceInBlock(
    block,
    "      const calls = [apiJson('/api/attendance?resource=state')]\n      if (MANAGEMENT.has(session.role)) calls.push(apiJson('/api/attendance?resource=live'))",
    "      const calls = [dedupeInflightJson('/api/attendance?resource=state', () => apiJson('/api/attendance?resource=state'))]\n      if (MANAGEMENT.has(session.role)) calls.push(dedupeInflightJson('/api/attendance?resource=live', () => apiJson('/api/attendance?resource=live')))",
    'Attendance Inflight-Deduplizierung',
  )
  app = app.slice(0, start) + block + app.slice(end)
}

// Schedule: reuse stable objects, keep entries fresh, and group rows once per date.
{
  const { start, end, block: original } = blockBetween(app, 'function SchedulePage({ session }) {', '\nfunction buildSessions', 'SchedulePage')
  let block = original
  if (!block.includes('const cachedObjects = peekCachedJson(OBJECTS_CACHE_KEY)')) {
    block = replaceInBlock(
      block,
      "      const cachedEmployees = session.role === 'scheduler' ? undefined : peekCachedJson(REGISTRATIONS_CACHE_KEY)\n      if (cachedEmployees !== undefined) setEmployees(cachedEmployees.employees || [])",
      "      const cachedEmployees = session.role === 'scheduler' ? undefined : peekCachedJson(REGISTRATIONS_CACHE_KEY)\n      if (cachedEmployees !== undefined) setEmployees(cachedEmployees.employees || [])\n      const cachedObjects = peekCachedJson(OBJECTS_CACHE_KEY)\n      if (cachedObjects !== undefined) setObjects(cachedObjects.objects || [])",
      'Dienstplan Einsatzort-Snapshot',
    )
  }
  block = replaceInBlock(
    block,
    "      const shiftRequest = apiJson(`/api/schedule-v2?resource=entries&from=${from}&to=${to}`)",
    "      const shiftPath = `/api/schedule-v2?resource=entries&from=${from}&to=${to}`\n      const shiftRequest = dedupeInflightJson(shiftPath, () => apiJson(shiftPath))",
    'Dienstplan dynamische Request-Deduplizierung',
  )
  block = replaceInBlock(
    block,
    "          apiJson('/api/schedule-v2?resource=objects'),",
    "          refreshCachedJson(OBJECTS_CACHE_KEY, () => apiJson(OBJECTS_CACHE_KEY), { ttlMs: OBJECTS_CACHE_TTL_MS }),",
    'Dienstplan Einsatzort-Cache',
  )
  if (!block.includes('const entriesByDate = useMemo')) {
    const updateMarker = "  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))"
    const updateAt = block.indexOf(updateMarker)
    assert.ok(updateAt > 0, 'Dienstplan Update-Marker für Datumsgruppen fehlt.')
    const grouping = "  const entriesByDate = useMemo(() => {\n    const grouped = new Map()\n    for (const entry of visibleEntries) {\n      if (!grouped.has(entry.date)) grouped.set(entry.date, [])\n      grouped.get(entry.date).push(entry)\n    }\n    return grouped\n  }, [visibleEntries])\n"
    block = block.slice(0, updateAt) + grouping + block.slice(updateAt)
    changed = true
  }
  if (block.includes("const dayEntries = visibleEntries.filter((entry) => entry.date === date)")) {
    block = block.replace("const dayEntries = visibleEntries.filter((entry) => entry.date === date)", "const dayEntries = entriesByDate.get(date) || []")
    changed = true
  }
  app = app.slice(0, start) + block + app.slice(end)
}

// Worksites: cached stable directory, always refreshed, invalidated after writes.
{
  const { start, end, block: original } = blockBetween(app, 'function WorksitesPage() {', '\nfunction CorrectionsPage', 'WorksitesPage')
  let block = original
  const oldLoad = "  const load = useCallback(async () => { try { const data = await apiJson('/api/schedule-v2?resource=objects'); setObjects(data.objects || []) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])"
  const newLoad = "  const load = useCallback(async () => {\n    try {\n      const cached = peekCachedJson(OBJECTS_CACHE_KEY)\n      if (cached !== undefined) setObjects(cached.objects || [])\n      const data = await refreshCachedJson(OBJECTS_CACHE_KEY, () => apiJson(OBJECTS_CACHE_KEY), { ttlMs: OBJECTS_CACHE_TTL_MS })\n      setObjects(data.objects || [])\n    } catch (error) { setNotice({ tone: 'error', text: error.message }) }\n  }, [])"
  if (!block.includes('const cached = peekCachedJson(OBJECTS_CACHE_KEY)')) block = replaceInBlock(block, oldLoad, newLoad, 'Einsatzorte Cached-then-fresh')
  if (!block.includes("invalidateCachedJson(OBJECTS_CACHE_KEY)\n      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })")) {
    block = replaceInBlock(
      block,
      "      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })",
      "      invalidateCachedJson(OBJECTS_CACHE_KEY)\n      setNotice({ tone: 'success', text: 'Einsatzort und Standortprüfung wurden gespeichert.' })",
      'Einsatzort Cache nach Speichern',
    )
  }
  if (!block.includes("invalidateCachedJson(OBJECTS_CACHE_KEY)\n      if (form.id === object.id) resetForm()")) {
    block = replaceInBlock(
      block,
      "      if (form.id === object.id) resetForm()",
      "      invalidateCachedJson(OBJECTS_CACHE_KEY)\n      if (form.id === object.id) resetForm()",
      'Einsatzort Cache nach Löschen',
    )
  }
  app = app.slice(0, start) + block + app.slice(end)
}

// Reports: employee directory can reuse the already loaded session snapshot.
{
  const { start, end, block: original } = blockBetween(app, 'function ReportsPage() {', '\nfunction SettingsPage', 'ReportsPage')
  let block = original
  const oldEffect = "  useEffect(() => { apiJson('/api/registrations').then((data) => setEmployees(data.employees || [])).catch((error) => setNotice({ tone: 'error', text: error.message })) }, [])"
  const newEffect = "  useEffect(() => {\n    let active = true\n    const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)\n    if (cached !== undefined) setEmployees(cached.employees || [])\n    refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson('/api/registrations'), { ttlMs: REGISTRATIONS_CACHE_TTL_MS })\n      .then((data) => { if (active) setEmployees(data.employees || []) })\n      .catch((error) => { if (active) setNotice({ tone: 'error', text: error.message }) })\n    return () => { active = false }\n  }, [])"
  if (!block.includes('let active = true\n    const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)')) block = replaceInBlock(block, oldEffect, newEffect, 'Berichte Mitarbeiter-Cache')
  app = app.slice(0, start) + block + app.slice(end)
}

// Settings: stable configuration can render from memory, then refresh.
{
  const { start, end, block: original } = blockBetween(app, 'function SettingsPage({ session }) {', '\n\nfunction UnifiedPortal', 'SettingsPage')
  let block = original
  const oldLoad = `  const load = useCallback(async () => {\n    try {\n      const data = await apiJson('/api/company-settings')\n      setForm((current) => ({ ...current, ...(data.settings || {}) }))\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [])`
  const newLoad = `  const load = useCallback(async () => {\n    try {\n      const cached = peekCachedJson(COMPANY_SETTINGS_CACHE_KEY)\n      if (cached !== undefined) setForm((current) => ({ ...current, ...(cached.settings || {}) }))\n      const data = await refreshCachedJson(COMPANY_SETTINGS_CACHE_KEY, () => apiJson('/api/company-settings'), { ttlMs: COMPANY_SETTINGS_CACHE_TTL_MS })\n      setForm((current) => ({ ...current, ...(data.settings || {}) }))\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [])`
  if (!block.includes('peekCachedJson(COMPANY_SETTINGS_CACHE_KEY)')) block = replaceInBlock(block, oldLoad, newLoad, 'Einstellungen Cached-then-fresh')
  const setFormLine = "      setForm((current) => ({ ...current, ...data.settings }))"
  const invalidateAndSet = "      invalidateCachedJson(COMPANY_SETTINGS_CACHE_KEY)\n      setForm((current) => ({ ...current, ...data.settings }))"
  if (!block.includes(invalidateAndSet)) {
    const count = block.split(setFormLine).length - 1
    assert.ok(count >= 3, `Einstellungen Cache-Invalidierung: erwartete mindestens 3 Schreibpfade, gefunden ${count}`)
    block = block.split(setFormLine).join(invalidateAndSet)
    changed = true
  }
  app = app.slice(0, start) + block + app.slice(end)
}

await writeFile(appPath, app)

// Timesheet has its own request helper, so apply the same safe rules there.
const timesheetPath = 'frontend/src/TimesheetPage.jsx'
let timesheet = await readFile(timesheetPath, 'utf8')
let timesheetChanged = false
const cacheImport = "import { dedupeInflightJson, peekCachedJson, refreshCachedJson } from './read-cache.js'\n"
if (!timesheet.includes(cacheImport)) {
  const anchor = "import { berlinDate } from './berlin-date.mjs'\n"
  assert.ok(timesheet.includes(anchor), 'Timesheet read-cache Import-Anker fehlt.')
  timesheet = timesheet.replace(anchor, `${anchor}${cacheImport}`)
  timesheetChanged = true
}
if (!timesheet.includes("const REGISTRATIONS_CACHE_KEY = '/api/registrations'")) {
  timesheet = timesheet.replace(
    "const MANAGEMENT = new Set(['owner', 'admin', 'manager'])\n",
    "const MANAGEMENT = new Set(['owner', 'admin', 'manager'])\nconst REGISTRATIONS_CACHE_KEY = '/api/registrations'\nconst REGISTRATIONS_CACHE_TTL_MS = 15000\n",
  )
  timesheetChanged = true
}
const oldTimesheetFormat = `function formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {\n  if (!value) return '–'\n  const date = new Date(String(value).length === 10 ? \`\${value}T12:00:00\` : value)\n  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', options).format(date) : '–'\n}`
const newTimesheetFormat = `const DATE_FORMATTERS = new Map()\nconst BERLIN_TIME_INPUT_FORMATTER = new Intl.DateTimeFormat('en-GB', {\n  timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',\n})\n\nfunction dateFormatter(options) {\n  const key = JSON.stringify(options || {})\n  let formatter = DATE_FORMATTERS.get(key)\n  if (!formatter) {\n    formatter = new Intl.DateTimeFormat('de-DE', options)\n    DATE_FORMATTERS.set(key, formatter)\n  }\n  return formatter\n}\n\nfunction formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {\n  if (!value) return '–'\n  const date = new Date(String(value).length === 10 ? \`\${value}T12:00:00\` : value)\n  return Number.isFinite(date.getTime()) ? dateFormatter(options).format(date) : '–'\n}`
if (!timesheet.includes('const DATE_FORMATTERS = new Map()')) {
  assert.ok(timesheet.includes(oldTimesheetFormat), 'Timesheet formatDate Marker fehlt.')
  timesheet = timesheet.replace(oldTimesheetFormat, newTimesheetFormat)
  timesheetChanged = true
}
const oldInputFormatter = `  const parts = new Intl.DateTimeFormat('en-GB', {\n    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',\n  }).formatToParts(date)`
if (timesheet.includes(oldInputFormatter)) {
  timesheet = timesheet.replace(oldInputFormatter, '  const parts = BERLIN_TIME_INPUT_FORMATTER.formatToParts(date)')
  timesheetChanged = true
}
const oldDirectory = `  const loadDirectory = useCallback(async () => {\n    if (!management) return\n    try {\n      const data = await requestJson('/api/registrations')\n      setEmployees(data.employees || [])\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [management])`
const newDirectory = `  const loadDirectory = useCallback(async () => {\n    if (!management) return\n    try {\n      const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)\n      if (cached !== undefined) setEmployees(cached.employees || [])\n      const data = await refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => requestJson('/api/registrations'), { ttlMs: REGISTRATIONS_CACHE_TTL_MS })\n      setEmployees((current) => {\n        const next = data.employees || []\n        return JSON.stringify(current) === JSON.stringify(next) ? current : next\n      })\n    } catch (error) {\n      setNotice({ tone: 'error', text: error.message })\n    }\n  }, [management])`
if (!timesheet.includes('peekCachedJson(REGISTRATIONS_CACHE_KEY)')) {
  assert.ok(timesheet.includes(oldDirectory), 'Timesheet Mitarbeiterverzeichnis Marker fehlt.')
  timesheet = timesheet.replace(oldDirectory, newDirectory)
  timesheetChanged = true
}
const oldActualData = "      const data = await requestJson(`/api/attendance?${params}`)"
const newActualData = "      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"
if (!timesheet.includes('const historyPath = `/api/attendance?${params}`')) {
  assert.ok(timesheet.includes(oldActualData), 'Timesheet Istzeiten Request-Marker fehlt.')
  timesheet = timesheet.replace(oldActualData, newActualData)
  timesheetChanged = true
}
const oldPlannedData = "      const data = await requestJson(`/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)"
const newPlannedData = "      const schedulePath = `/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`\n      const data = await dedupeInflightJson(schedulePath, () => requestJson(schedulePath))"
if (!timesheet.includes('const schedulePath = `/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}')) {
  assert.ok(timesheet.includes(oldPlannedData), 'Timesheet Planzeiten Request-Marker fehlt.')
  timesheet = timesheet.replace(oldPlannedData, newPlannedData)
  timesheetChanged = true
}
if (timesheetChanged) await writeFile(timesheetPath, timesheet)

console.log(changed || timesheetChanged ? 'Full portal performance optimizations applied' : 'Full portal performance optimizations already applied')
