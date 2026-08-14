import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const overviewPath = 'frontend/src/AdminOverview.jsx'
let source = await readFile(overviewPath, 'utf8')
let changed = false

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  const count = source.split(before).length - 1
  assert.equal(count, 1, `${label}: erwartete genau einen Marker, gefunden ${count}`)
  source = source.replace(before, after)
  changed = true
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
replaceOnce(oldStatusRow, newStatusRow, 'AdminOverview StatusRow Loading')

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
replaceOnce(oldStateStart, newStateStart, 'AdminOverview Snapshot-State')

const duplicateToday = "  const today = useMemo(() => berlinDateKey(), [])\n  const [reportDate, setReportDate] = useState(today)"
const reportDateOnly = "  const [reportDate, setReportDate] = useState(today)"
if (source.includes(duplicateToday)) {
  source = source.replace(duplicateToday, reportDateOnly)
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
replaceOnce(oldLoadOverview, newLoadOverview, 'AdminOverview paralleles Laden')

const statusRows = [
  ['working', 'Im Dienst', 'working', 'groups.working'],
  ['paused', 'In Pause', 'paused', 'groups.paused'],
  ['not-started', 'Noch nicht gestartet', 'not-started', 'groups.notStarted'],
  ['completed', 'Dienst beendet', 'completed', 'groups.completed'],
]
for (const [id, label, tone, entries] of statusRows) {
  const oldRow = `<StatusRow id="${id}" label="${label}" tone="${tone}" entries={${entries}} open={openGroup === '${id}'} onToggle={() => setOpenGroup((value) => value === '${id}' ? '' : '${id}')} />`
  const newRow = `<StatusRow id="${id}" label="${label}" tone="${tone}" entries={${entries}} loading={!scheduleLoaded || !liveLoaded} open={openGroup === '${id}'} onToggle={() => setOpenGroup((value) => value === '${id}' ? '' : '${id}')} />`
  replaceOnce(oldRow, newRow, `AdminOverview ${id} Loading-Prop`)
}

const oldTodayRender = `{todayShifts.length ? <div className="admin-today-list">{todayShifts.map((shift) => (`
const newTodayRender = `{!scheduleLoaded ? <div className="admin-today-empty"><Icon name="users" /><span>Daten werden geladen …</span></div> : todayShifts.length ? <div className="admin-today-list">{todayShifts.map((shift) => (`
replaceOnce(oldTodayRender, newTodayRender, 'AdminOverview Heute Loading')

if (changed) await writeFile(overviewPath, source)

const verified = await readFile(overviewPath, 'utf8')
assert.match(verified, /from '\.\/display-snapshots\.js'/)
assert.match(verified, /const \[scheduleLoaded, setScheduleLoaded\]/)
assert.match(verified, /const \[liveLoaded, setLiveLoaded\]/)
assert.match(verified, /Promise\.allSettled\(/)
assert.match(verified, /loading=\{!scheduleLoaded \|\| !liveLoaded\}/)
assert.match(verified, /loading \? '…' : entries\.length/)
assert.doesNotMatch(verified, /await apiJson\(`\/api\/schedule-v2[\s\S]*?await apiJson\(`\/api\/attendance\?resource=live/)

console.log(changed ? 'Instant admin overview performance applied' : 'Instant admin overview performance already applied')
