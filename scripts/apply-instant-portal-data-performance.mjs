import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return { source, changed: false }
  const count = source.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  return { source: source.replace(before, after), changed: true }
}

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `${label} wurde nicht gefunden.`)
  return { start, end, block: source.slice(start, end) }
}

async function applyAdminOverview() {
  const overviewPath = 'frontend/src/AdminOverview.jsx'
  let source = await readFile(overviewPath, 'utf8')
  let changed = false
  const apply = (before, after, label) => {
    const result = replaceOnce(source, before, after, label)
    source = result.source
    changed ||= result.changed
  }

  const utilsImport = "import { ADMIN_OVERVIEW_TIME_ZONE, berlinDateKey, buildDeploymentGroups, countReportWords } from './admin-overview-utils.mjs'\n"
  const snapshotImport = "import { peekDisplaySnapshot, setDisplaySnapshot } from './display-snapshots.js'\n"
  if (!source.includes(snapshotImport)) {
    assert.ok(source.includes(utilsImport), 'AdminOverview Import-Marker fehlt.')
    source = source.replace(utilsImport, `${utilsImport}${snapshotImport}`)
    changed = true
  }

  const oldStatusRow = `function StatusRow({ id, label, tone, entries, open, onToggle }) {
  return (
    <div className={\`deployment-status deployment-status-\${tone}\`}>
      <button type="button" className="deployment-status-button" aria-expanded={open} aria-controls={\`deployment-group-\${id}\`} onClick={onToggle}>
        <span className="deployment-status-dot" aria-hidden="true" />
        <span className="deployment-status-label">{label} <b>· {entries.length}</b></span>
        <span className={\`deployment-chevron \${open ? 'open' : ''}\`}><Icon name="chevron" /></span>
      </button>
      {open && <div id={\`deployment-group-\${id}\`} className="deployment-names">
        {entries.length ? entries.map((entry) => <span key={entry.key}>{entry.name}</span>) : <span className="deployment-empty">Keine Mitarbeiter</span>}
      </div>}
    </div>
  )
}`

  const newStatusRow = `function StatusRow({ id, label, tone, entries, loading, open, onToggle }) {
  return (
    <div className={\`deployment-status deployment-status-\${tone}\`}>
      <button type="button" className="deployment-status-button" aria-expanded={open} aria-controls={\`deployment-group-\${id}\`} onClick={onToggle}>
        <span className="deployment-status-dot" aria-hidden="true" />
        <span className="deployment-status-label">{label} <b>· {loading ? '…' : entries.length}</b></span>
        <span className={\`deployment-chevron \${open ? 'open' : ''}\`}><Icon name="chevron" /></span>
      </button>
      {open && <div id={\`deployment-group-\${id}\`} className="deployment-names">
        {loading ? <span className="deployment-empty">Daten werden geladen …</span> : entries.length ? entries.map((entry) => <span key={entry.key}>{entry.name}</span>) : <span className="deployment-empty">Keine Mitarbeiter</span>}
      </div>}
    </div>
  )
}`
  apply(oldStatusRow, newStatusRow, 'AdminOverview StatusRow Loading')

  const oldStateStart = `export default function AdminOverview({ session, navigate }) {
  const isAdmin = ADMINISTRATION.has(session.role)
  const [schedule, setSchedule] = useState([])
  const [liveAttendance, setLiveAttendance] = useState([])`
  const newStateStart = `export default function AdminOverview({ session, navigate }) {
  const isAdmin = ADMINISTRATION.has(session.role)
  const today = useMemo(() => berlinDateKey(), [])
  const scheduleSnapshotKey = \`admin-overview:schedule:\${today}\`
  const liveSnapshotKey = \`admin-overview:live:\${today}\`
  const initialSchedule = peekDisplaySnapshot(scheduleSnapshotKey)
  const initialLiveAttendance = isAdmin ? peekDisplaySnapshot(liveSnapshotKey) : undefined
  const [schedule, setSchedule] = useState(() => Array.isArray(initialSchedule) ? initialSchedule : [])
  const [liveAttendance, setLiveAttendance] = useState(() => Array.isArray(initialLiveAttendance) ? initialLiveAttendance : [])
  const [scheduleLoaded, setScheduleLoaded] = useState(() => initialSchedule !== undefined)
  const [liveLoaded, setLiveLoaded] = useState(() => !isAdmin || initialLiveAttendance !== undefined)`
  apply(oldStateStart, newStateStart, 'AdminOverview Snapshot-State')

  const duplicateToday = "  const today = useMemo(() => berlinDateKey(), [])\n  const [reportDate, setReportDate] = useState(today)"
  if (source.includes(duplicateToday)) {
    source = source.replace(duplicateToday, "  const [reportDate, setReportDate] = useState(today)")
    changed = true
  }

  const oldLoadOverview = `  const loadOverview = useCallback(async () => {
    try {
      const scheduleData = await apiJson(\`/api/schedule-v2?resource=entries&from=\${encodeURIComponent(today)}&to=\${encodeURIComponent(today)}\`)
      setSchedule(Array.isArray(scheduleData.entries) ? scheduleData.entries : [])
      setOverviewNotice(null)
    } catch (error) {
      setOverviewNotice({ tone: 'error', text: error.message || 'Der heutige Dienstplan konnte nicht geladen werden.' })
    }

    if (!isAdmin) return
    try {
      const liveData = await apiJson(\`/api/attendance?resource=live&date=\${encodeURIComponent(today)}\`)
      setLiveAttendance(Array.isArray(liveData.entries) ? liveData.entries : [])
      setCommandNotice(null)
    } catch (error) {
      setCommandNotice(error.message || 'Die Einsatz-Zentrale konnte nicht vollständig geladen werden.')
    }
  }, [isAdmin, today])`

  const newLoadOverview = `  const loadOverview = useCallback(async () => {
    const schedulePath = \`/api/schedule-v2?resource=entries&from=\${encodeURIComponent(today)}&to=\${encodeURIComponent(today)}\`
    const livePath = \`/api/attendance?resource=live&date=\${encodeURIComponent(today)}\`
    const requests = [apiJson(schedulePath), isAdmin ? apiJson(livePath) : Promise.resolve(null)]
    const [scheduleResult, liveResult] = await Promise.allSettled(requests)

    if (scheduleResult.status === 'fulfilled') {
      const entries = Array.isArray(scheduleResult.value?.entries) ? scheduleResult.value.entries : []
      setSchedule(entries)
      setDisplaySnapshot(scheduleSnapshotKey, entries, 30000)
      setOverviewNotice(null)
    } else {
      setOverviewNotice({ tone: 'error', text: scheduleResult.reason?.message || 'Der heutige Dienstplan konnte nicht geladen werden.' })
    }
    setScheduleLoaded(true)

    if (!isAdmin) {
      setLiveLoaded(true)
      return
    }

    if (liveResult.status === 'fulfilled') {
      const entries = Array.isArray(liveResult.value?.entries) ? liveResult.value.entries : []
      setLiveAttendance(entries)
      setDisplaySnapshot(liveSnapshotKey, entries, 15000)
      setCommandNotice(null)
    } else {
      setCommandNotice(liveResult.reason?.message || 'Die Einsatz-Zentrale konnte nicht vollständig geladen werden.')
    }
    setLiveLoaded(true)
  }, [isAdmin, liveSnapshotKey, scheduleSnapshotKey, today])`
  apply(oldLoadOverview, newLoadOverview, 'AdminOverview paralleles Laden')

  const statusRows = [
    ['working', 'Im Dienst', 'working', 'groups.working'],
    ['paused', 'In Pause', 'paused', 'groups.paused'],
    ['not-started', 'Noch nicht gestartet', 'not-started', 'groups.notStarted'],
    ['completed', 'Dienst beendet', 'completed', 'groups.completed'],
  ]
  for (const [id, label, tone, entries] of statusRows) {
    const oldRow = `<StatusRow id="${id}" label="${label}" tone="${tone}" entries={${entries}} open={openGroup === '${id}'} onToggle={() => setOpenGroup((value) => value === '${id}' ? '' : '${id}')} />`
    const newRow = `<StatusRow id="${id}" label="${label}" tone="${tone}" entries={${entries}} loading={!scheduleLoaded || !liveLoaded} open={openGroup === '${id}'} onToggle={() => setOpenGroup((value) => value === '${id}' ? '' : '${id}')} />`
    apply(oldRow, newRow, `AdminOverview ${id} Loading-Prop`)
  }

  apply(
    `{todayShifts.length ? <div className="admin-today-list">{todayShifts.map((shift) => (`,
    `{!scheduleLoaded ? <div className="admin-today-empty"><Icon name="users" /><span>Daten werden geladen …</span></div> : todayShifts.length ? <div className="admin-today-list">{todayShifts.map((shift) => (`,
    'AdminOverview Heute Loading',
  )

  if (changed) await writeFile(overviewPath, source)

  const verified = await readFile(overviewPath, 'utf8')
  assert.match(verified, /from '\.\/display-snapshots\.js'/)
  assert.match(verified, /const \[scheduleLoaded, setScheduleLoaded\]/)
  assert.match(verified, /const \[liveLoaded, setLiveLoaded\]/)
  assert.match(verified, /Promise\.allSettled\(/)
  assert.match(verified, /loading=\{!scheduleLoaded \|\| !liveLoaded\}/)
  assert.match(verified, /loading \? '…' : entries\.length/)
  return changed
}

async function applyScheduleSnapshots() {
  const appPath = 'frontend/src/App.jsx'
  let app = await readFile(appPath, 'utf8')
  let changed = false

  const readCacheImport = "import { clearReadCache, dedupeInflightJson, invalidateCachedJson, peekCachedJson, refreshCachedJson } from './read-cache.js'\n"
  const snapshotImport = "import { clearDisplaySnapshots, invalidateDisplaySnapshots, peekDisplaySnapshot, setDisplaySnapshot } from './display-snapshots.js'\n"
  if (!app.includes(snapshotImport)) {
    assert.ok(app.includes(readCacheImport), 'App Display-Snapshot Import-Anker fehlt. Full-Portal-Performance muss zuerst laufen.')
    app = app.replace(readCacheImport, `${readCacheImport}${snapshotImport}`)
    changed = true
  }

  const { start, end, block: original } = section(app, 'function SchedulePage({ session }) {', '\nfunction buildSessions', 'SchedulePage')
  let block = original

  const shiftMarker = "      const shiftPath = `/api/schedule-v2?resource=entries&from=${from}&to=${to}`\n      const shiftRequest = dedupeInflightJson(shiftPath, () => apiJson(shiftPath))"
  const shiftWithSnapshot = "      const shiftPath = `/api/schedule-v2?resource=entries&from=${from}&to=${to}`\n      const scheduleSnapshotKey = `schedule-display:${session.userId || session.id || 'session'}:${shiftPath}`\n      const cachedShiftData = peekDisplaySnapshot(scheduleSnapshotKey)\n      if (cachedShiftData !== undefined) setEntries(cachedShiftData.entries || [])\n      const shiftRequest = dedupeInflightJson(shiftPath, () => apiJson(shiftPath))"
  if (!block.includes('const scheduleSnapshotKey = `schedule-display:')) {
    assert.ok(block.includes(shiftMarker), 'Schedule Snapshot Request-Marker fehlt.')
    block = block.replace(shiftMarker, shiftWithSnapshot)
    changed = true
  }

  if (!block.includes('setDisplaySnapshot(scheduleSnapshotKey')) {
    const setMarker = '      setEntries(shiftData.entries || [])'
    const at = block.lastIndexOf(setMarker)
    assert.ok(at >= 0, 'Schedule finaler setEntries-Marker fehlt.')
    const replacement = `${setMarker}\n      setDisplaySnapshot(scheduleSnapshotKey, shiftData, 30000)`
    block = block.slice(0, at) + replacement + block.slice(at + setMarker.length)
    changed = true
  }

  if (!block.includes("invalidateDisplaySnapshots((key) => key.startsWith('schedule-display:'))")) {
    const reloadMarker = '      await load()'
    const count = block.split(reloadMarker).length - 1
    assert.ok(count >= 3, `Schedule Snapshot-Invalidierung erwartete mindestens 3 Schreibpfade, gefunden ${count}`)
    block = block.split(reloadMarker).join("      invalidateDisplaySnapshots((key) => key.startsWith('schedule-display:'))\n      await load()")
    changed = true
  }

  if (block !== original) app = app.slice(0, start) + block + app.slice(end)

  const loadSessionMarker = "    clearReadCache()\n    if (!user) { setSession(null); setLoading(false); return }"
  const loadSessionWithDisplayClear = "    clearReadCache()\n    clearDisplaySnapshots()\n    if (!user) { setSession(null); setLoading(false); return }"
  if (!app.includes(loadSessionWithDisplayClear)) {
    assert.ok(app.includes(loadSessionMarker), 'Session Cache-Clear Marker fehlt.')
    app = app.replace(loadSessionMarker, loadSessionWithDisplayClear)
    changed = true
  }

  const signOutMarker = "  async function signOut() { clearReadCache(); await logout(); setIdentityUser(null); setSession(null) }"
  const signOutWithDisplayClear = "  async function signOut() { clearReadCache(); clearDisplaySnapshots(); await logout(); setIdentityUser(null); setSession(null) }"
  if (!app.includes(signOutWithDisplayClear)) {
    assert.ok(app.includes(signOutMarker), 'Logout Cache-Clear Marker fehlt.')
    app = app.replace(signOutMarker, signOutWithDisplayClear)
    changed = true
  }

  if (changed) await writeFile(appPath, app)

  const verified = await readFile(appPath, 'utf8')
  assert.match(verified, /schedule-display:/)
  assert.match(verified, /peekDisplaySnapshot\(scheduleSnapshotKey\)/)
  assert.match(verified, /setDisplaySnapshot\(scheduleSnapshotKey/)
  assert.match(verified, /invalidateDisplaySnapshots\(\(key\) => key\.startsWith\('schedule-display:'\)\)/)
  assert.match(verified, /clearDisplaySnapshots\(\)/)
  return changed
}

async function applyTimesheetSnapshots() {
  const timesheetPath = 'frontend/src/TimesheetPage.jsx'
  let source = await readFile(timesheetPath, 'utf8')
  let changed = false

  const readCacheImport = "import { dedupeInflightJson, peekCachedJson, refreshCachedJson } from './read-cache.js'\n"
  const snapshotImport = "import { invalidateDisplaySnapshots, peekDisplaySnapshot, setDisplaySnapshot } from './display-snapshots.js'\n"
  if (!source.includes(snapshotImport)) {
    assert.ok(source.includes(readCacheImport), 'Timesheet Display-Snapshot Import-Anker fehlt. Full-Portal-Performance muss zuerst laufen.')
    source = source.replace(readCacheImport, `${readCacheImport}${snapshotImport}`)
    changed = true
  }

  {
    const { start, end, block: original } = section(source, '  const loadActual = useCallback(async () => {', '\n\n  const loadPlanned', 'Timesheet loadActual')
    let block = original
    const historyMarker = "      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"
    const historyWithSnapshot = "      const actualSnapshotKey = `timesheet-actual:${sessionUserId}:${management ? userId || 'all' : sessionUserId}:${from}:${to}`\n      const cachedActualRows = peekDisplaySnapshot(actualSnapshotKey)\n      if (cachedActualRows !== undefined) setActual({ rows: cachedActualRows, error: '' })\n      const historyPath = `/api/attendance?${params}`\n      const data = await dedupeInflightJson(historyPath, () => requestJson(historyPath))"
    if (!block.includes('const actualSnapshotKey = `timesheet-actual:')) {
      assert.ok(block.includes(historyMarker), 'Timesheet Istzeiten Snapshot-Marker fehlt.')
      block = block.replace(historyMarker, historyWithSnapshot)
      changed = true
    }
    const setActualMarker = "      setActual({ rows, error: '' })"
    const setActualWithSnapshot = "      setActual({ rows, error: '' })\n      setDisplaySnapshot(actualSnapshotKey, rows, 30000)"
    if (!block.includes('setDisplaySnapshot(actualSnapshotKey')) {
      assert.ok(block.includes(setActualMarker), 'Timesheet Istzeiten setActual-Marker fehlt.')
      block = block.replace(setActualMarker, setActualWithSnapshot)
      changed = true
    }
    if (block.includes('  }, [employeeNames, from, management, to, userId])')) {
      block = block.replace('  }, [employeeNames, from, management, to, userId])', '  }, [employeeNames, from, management, sessionUserId, to, userId])')
      changed = true
    }
    if (block !== original) source = source.slice(0, start) + block + source.slice(end)
  }

  {
    const { start, end, block: original } = section(source, '  const loadPlanned = useCallback(async () => {', '\n\n  const reload', 'Timesheet loadPlanned')
    let block = original
    const scheduleMarker = "      const schedulePath = `/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`\n      const data = await dedupeInflightJson(schedulePath, () => requestJson(schedulePath))"
    const scheduleWithSnapshot = "      const plannedSnapshotKey = `timesheet-planned:${sessionUserId}:${management ? userId || 'all' : sessionUserId}:${from}:${to}`\n      const cachedPlannedRows = peekDisplaySnapshot(plannedSnapshotKey)\n      if (cachedPlannedRows !== undefined) setPlanned({ rows: cachedPlannedRows, error: '' })\n      const schedulePath = `/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`\n      const data = await dedupeInflightJson(schedulePath, () => requestJson(schedulePath))"
    if (!block.includes('const plannedSnapshotKey = `timesheet-planned:')) {
      assert.ok(block.includes(scheduleMarker), 'Timesheet Planzeiten Snapshot-Marker fehlt.')
      block = block.replace(scheduleMarker, scheduleWithSnapshot)
      changed = true
    }
    const setPlannedMarker = "      setPlanned({ rows: buildPlannedRows(entries, employeeNames), error: '' })"
    const setPlannedWithSnapshot = "      const plannedRows = buildPlannedRows(entries, employeeNames)\n      setPlanned({ rows: plannedRows, error: '' })\n      setDisplaySnapshot(plannedSnapshotKey, plannedRows, 30000)"
    if (!block.includes('setDisplaySnapshot(plannedSnapshotKey')) {
      assert.ok(block.includes(setPlannedMarker), 'Timesheet Planzeiten setPlanned-Marker fehlt.')
      block = block.replace(setPlannedMarker, setPlannedWithSnapshot)
      changed = true
    }
    if (block !== original) source = source.slice(0, start) + block + source.slice(end)
  }

  if (!source.includes("invalidateDisplaySnapshots((key) => key.startsWith('timesheet-'))")) {
    const marker = '      await loadActual()'
    const count = source.split(marker).length - 1
    assert.equal(count, 1, `Timesheet Snapshot-Invalidierung erwartete einen loadActual-Schreibpfad, gefunden ${count}`)
    source = source.replace(marker, "      invalidateDisplaySnapshots((key) => key.startsWith('timesheet-'))\n      await loadActual()")
    changed = true
  }

  if (changed) await writeFile(timesheetPath, source)

  const verified = await readFile(timesheetPath, 'utf8')
  assert.match(verified, /timesheet-actual:/)
  assert.match(verified, /timesheet-planned:/)
  assert.match(verified, /peekDisplaySnapshot\(actualSnapshotKey\)/)
  assert.match(verified, /peekDisplaySnapshot\(plannedSnapshotKey\)/)
  assert.match(verified, /setDisplaySnapshot\(actualSnapshotKey/)
  assert.match(verified, /setDisplaySnapshot\(plannedSnapshotKey/)
  assert.match(verified, /invalidateDisplaySnapshots\(\(key\) => key\.startsWith\('timesheet-'\)\)/)
  return changed
}

const results = await Promise.all([
  applyAdminOverview(),
  applyScheduleSnapshots(),
  applyTimesheetSnapshots(),
])

console.log(results.some(Boolean) ? 'Instant portal data performance applied' : 'Instant portal data performance already applied')
