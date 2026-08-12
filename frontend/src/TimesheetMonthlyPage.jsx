import { useCallback, useEffect, useMemo, useState } from 'react'
import { peekCachedJson, refreshCachedJson } from './read-cache.js'
import './timesheet.css'

const REGISTRATIONS_CACHE_KEY = '/api/registrations'
const REGISTRATIONS_CACHE_TTL_MS = 15000

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = {}
  try { body = text ? JSON.parse(text) : {} } catch { body = { message: text } }
  if (!response.ok) throw new Error(body.message || `Die Anfrage ist fehlgeschlagen (${response.status}).`)
  return body
}

async function requestBlob(path, payload, expectedType) {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `Die Datei konnte nicht erstellt werden (${response.status}).`)
  }
  const blob = await response.blob()
  const type = String(response.headers.get('content-type') || blob.type || '').toLowerCase()
  if (!type.includes(expectedType.toLowerCase())) throw new Error('Der Server hat keinen gültigen Dateityp geliefert.')
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  return { blob, filename: encoded ? decodeURIComponent(encoded) : plain || 'Habun-Stundenzettel' }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = String(filename || 'Habun-Stundenzettel').replace(/[\\/]/g, '-')
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 120000)
}

function berlinDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} Std.`
}
function formatDate(value) {
  if (!value) return '–'
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date) : value
}
function InlineNotice({ tone = 'info', children }) {
  if (!children) return null
  return <div className={`notice notice-${tone}`} role="status">{children}</div>
}

export default function TimesheetMonthlyPage() {
  const today = berlinDate()
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [employees, setEmployees] = useState([])
  const [userId, setUserId] = useState('')
  const [rows, setRows] = useState([])
  const [months, setMonths] = useState([])
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [editor, setEditor] = useState(null)

  const totalMinutes = useMemo(() => rows.reduce((sum, row) => sum + Math.max(0, Number(row.netMinutes) || 0), 0), [rows])
  const selectedEmployee = useMemo(() => employees.find((employee) => String(employee.userId || employee.id || '') === userId) || null, [employees, userId])

  const loadDirectory = useCallback(async () => {
    try {
      const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)
      if (cached !== undefined) setEmployees(cached.employees || [])
      const data = await refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => requestJson('/api/registrations'), { ttlMs: REGISTRATIONS_CACHE_TTL_MS })
      setEmployees(data.employees || [])
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [])

  const loadTimesheet = useCallback(async () => {
    setBusy('load')
    try {
      const params = new URLSearchParams({ from, to })
      if (userId) params.set('userId', userId)
      const data = await requestJson(`/api/timesheets?${params}`)
      setRows(data.entries || [])
      setMonths(data.months || [])
    } catch (error) {
      setRows([])
      setNotice({ tone: 'error', text: error.message })
    } finally { setBusy('') }
  }, [from, to, userId])

  useEffect(() => { loadDirectory() }, [loadDirectory])
  useEffect(() => { loadTimesheet() }, [loadTimesheet])

  function openExisting(row) {
    setEditor({
      mode: 'edit', id: row.id, employeeUserId: row.employeeUserId, employeeName: row.employeeName,
      date: row.workDate, start: row.start, end: row.end, pauseMinutes: String(row.pauseMinutes || 0),
      location: row.location || '', workArea: row.workArea || '', reason: 'Korrektur im Stundenzettel',
    })
  }
  function openNew() {
    if (!selectedEmployee) return setNotice({ tone: 'warning', text: 'Bitte zuerst einen Mitarbeiter auswählen.' })
    setEditor({
      mode: 'new', employeeUserId: String(selectedEmployee.userId || selectedEmployee.id || ''),
      employeeName: selectedEmployee.fullName || 'Mitarbeiter', date: to, start: '07:00', end: '17:00',
      pauseMinutes: '0', location: selectedEmployee.location || '', workArea: '', reason: 'Manueller Stundenzettel-Eintrag',
    })
  }

  async function saveEditor(event) {
    event.preventDefault()
    if (!editor) return
    const pauseMinutes = Number(editor.pauseMinutes)
    if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0) return setNotice({ tone: 'error', text: 'Die Pause muss eine ganze Minute ab 0 sein.' })
    setBusy('save'); setNotice(null)
    try {
      const payload = {
        action: editor.mode === 'edit' ? 'manual-update' : 'manual-create',
        ...(editor.id ? { id: editor.id } : {}),
        employeeUserId: editor.employeeUserId, employeeName: editor.employeeName,
        date: editor.date, start: editor.start, end: editor.end, pauseMinutes,
        location: editor.location, workArea: editor.workArea, reason: editor.reason,
      }
      await requestJson('/api/timesheets', { method: editor.mode === 'edit' ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      setEditor(null); setNotice({ tone: 'success', text: 'Stundenzettel wurde gespeichert.' }); await loadTimesheet()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) } finally { setBusy('') }
  }

  async function deleteEditor() {
    if (!editor?.id) return
    if (!window.confirm('Diesen Stundenzettel-Eintrag wirklich löschen? Der Dienstplan bleibt unverändert.')) return
    setBusy('delete'); setNotice(null)
    try {
      await requestJson('/api/timesheets', {
        method: 'DELETE',
        body: JSON.stringify({ action: 'manual-delete', id: editor.id, reason: editor.reason || 'Stundenzettel-Eintrag gelöscht' }),
      })
      setEditor(null); setNotice({ tone: 'success', text: 'Stundenzettel-Eintrag wurde gelöscht.' }); await loadTimesheet()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) } finally { setBusy('') }
  }

  async function exportTimesheet(format) {
    setBusy(`export-${format}`); setNotice(null)
    try {
      const expected = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'
      const { blob, filename } = await requestBlob('/api/timesheet-reports', { from, to, userIds: userId ? [userId] : [], format, scope: 'unified' }, expected)
      downloadBlob(blob, filename); setNotice({ tone: 'success', text: 'Stundenzettel wurde erstellt.' })
    } catch (error) { setNotice({ tone: 'error', text: error.message }) } finally { setBusy('') }
  }

  const closedMonths = months.filter((month) => !month.scheduleSyncOpen)

  return <div className="timesheet-page">
    <section className="panel filter-panel timesheet-filter">
      <div className="page-heading"><div><h2>Stundenzettel</h2><p>Der Stundenzettel übernimmt veröffentlichte Dienstplanzeiten. Stempelzeiten werden hier nicht eingerechnet.</p></div></div>
      <div className="filter-grid">
        <label>Von<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Bis<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Mitarbeiter<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Alle Mitarbeiter</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label>
        <button className="primary-button" type="button" disabled={busy === 'load'} onClick={loadTimesheet}>{busy === 'load' ? 'Wird geladen …' : 'Zeitraum anzeigen'}</button>
      </div>
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={openNew}>Eintrag hinzufügen</button>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => exportTimesheet('pdf')}>PDF</button>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => exportTimesheet('xlsx')}>Excel</button>
      </div>
    </section>

    {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
    {closedMonths.length > 0 && <InlineNotice>Bei abgeschlossenen Monaten ändern spätere Dienstplanänderungen den Stundenzettel nicht mehr. Manuelle Korrekturen bleiben möglich.</InlineNotice>}

    {editor && <section className="panel editor-panel timesheet-editor">
      <div className="page-heading"><div><h2>{editor.mode === 'edit' ? 'Stundenzettel korrigieren' : 'Stundenzettel-Eintrag hinzufügen'}</h2></div><button type="button" className="secondary-button compact" onClick={() => setEditor(null)}>Schließen</button></div>
      <form className="schedule-form" onSubmit={saveEditor}>
        <div className="form-grid three">
          <label>Datum<input type="date" required value={editor.date} onChange={(event) => setEditor((current) => ({ ...current, date: event.target.value }))} /></label>
          <label>Beginn<input type="time" required value={editor.start} onChange={(event) => setEditor((current) => ({ ...current, start: event.target.value }))} /></label>
          <label>Ende<input type="time" required value={editor.end} onChange={(event) => setEditor((current) => ({ ...current, end: event.target.value }))} /></label>
          <label>Pause in Minuten<input type="number" min="0" step="1" required value={editor.pauseMinutes} onChange={(event) => setEditor((current) => ({ ...current, pauseMinutes: event.target.value }))} /></label>
          <label>Einsatzort<input required value={editor.location} onChange={(event) => setEditor((current) => ({ ...current, location: event.target.value }))} /></label>
          <label>Bereich<input required value={editor.workArea} onChange={(event) => setEditor((current) => ({ ...current, workArea: event.target.value }))} /></label>
        </div>
        <label>Begründung<input required value={editor.reason} onChange={(event) => setEditor((current) => ({ ...current, reason: event.target.value }))} /></label>
        <div className="button-row">
          <button className="primary-button" disabled={busy === 'save' || busy === 'delete'}>{busy === 'save' ? 'Wird gespeichert …' : 'Speichern'}</button>
          {editor.mode === 'edit' && <button type="button" className="secondary-button danger-button" disabled={busy === 'save' || busy === 'delete'} onClick={deleteEditor}>{busy === 'delete' ? 'Wird gelöscht …' : 'Löschen'}</button>}
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>Schließen</button>
        </div>
      </form>
    </section>}

    <section className="panel">
      <div className="page-heading"><div><h2>Arbeitszeiten</h2><p>{rows.length} Einträge · Gesamt {formatDuration(totalMinutes)}</p></div></div>

      <div className="timesheet-mobile-list">
        {rows.length === 0 && <div className="timesheet-empty">Für den ausgewählten Zeitraum sind keine Stundenzettel-Einträge vorhanden.</div>}
        {rows.map((row) => <article className="timesheet-mobile-card" key={`mobile-${row.id}`}>
          <header><strong>{row.employeeName}</strong><span>{formatDate(row.workDate)}</span></header>
          <div className="timesheet-values">
            <div><span>Beginn</span><strong>{row.start}</strong></div>
            <div><span>Ende</span><strong>{row.end}</strong></div>
            <div><span>Pause</span><strong>{row.pauseMinutes} Min.</strong></div>
            <div><span>Dauer</span><strong>{formatDuration(row.netMinutes)}</strong></div>
            <div className="timesheet-wide-value"><span>Bereich</span><strong>{row.workArea || '–'}</strong></div>
            <div className="timesheet-wide-value"><span>Einsatzort</span><strong>{row.location || '–'}</strong></div>
          </div>
          <footer><span>{row.source === 'manual' || row.manualOverride ? 'Manuell' : 'Dienstplan'}</span><button className="secondary-button compact" type="button" onClick={() => openExisting(row)}>Bearbeiten</button></footer>
        </article>)}
      </div>

      <div className="table-scroll timesheet-desktop-table"><table><thead><tr><th>Mitarbeiter</th><th>Datum</th><th>Beginn</th><th>Ende</th><th>Pause</th><th>Dauer</th><th>Bereich / Einsatzort</th><th></th></tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan="8">Für den ausgewählten Zeitraum sind keine Stundenzettel-Einträge vorhanden.</td></tr>}
        {rows.map((row) => <tr key={row.id}>
          <td>{row.employeeName}</td><td>{formatDate(row.workDate)}</td><td>{row.start}</td><td>{row.end}</td><td>{row.pauseMinutes} Min.</td><td>{formatDuration(row.netMinutes)}</td><td>{row.workArea || '–'} · {row.location || '–'}</td><td><button className="secondary-button compact" type="button" onClick={() => openExisting(row)}>Bearbeiten</button></td>
        </tr>)}
      </tbody></table></div>
    </section>
  </div>
}
