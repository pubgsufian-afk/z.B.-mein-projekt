import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildActualSessions, buildPlannedRows, sumMinutes, totalsByEmployee } from './timesheet-utils.js'
import { berlinDate } from './berlin-date.mjs'
import { mergeTimesheetRows } from './timesheet-unified.js'
import './timesheet.css'

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])

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
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `Die Datei konnte nicht erstellt werden (${response.status}).`)
  }
  const blob = await response.blob()
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase()
  if (!contentType.includes(expectedType.toLowerCase())) throw new Error('Der Server hat keinen gültigen Dateityp geliefert.')
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const filename = encoded ? decodeURIComponent(encoded) : plain || 'Habun-Stundenzettel'
  return { blob, filename: filename.replace(/[\\/]/g, '-') }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 120000)
}

function formatDate(value, options = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!value) return '–'
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', options).format(date) : '–'
}

function formatDuration(minutes) {
  const total = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  return `${hours}:${String(rest).padStart(2, '0')} Std.`
}

function addDateDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function timeForInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value || '00'
  return `${part('hour')}:${part('minute')}`
}

function dateTimeFromInputs(date, time, addDayWhenNeeded = false, startTime = '') {
  if (!date || !time) return null
  const result = new Date(`${date}T${time}:00`)
  if (!Number.isFinite(result.getTime())) return null
  if (addDayWhenNeeded && startTime && time <= startTime) result.setDate(result.getDate() + 1)
  return result
}

function InlineNotice({ tone = 'info', children }) {
  if (!children) return null
  return <div className={`notice notice-${tone}`} role="status">{children}</div>
}

function Summary({ rows }) {
  const employeeTotals = totalsByEmployee(rows)
  const grandTotal = sumMinutes(rows)
  return <div className="timesheet-summary" aria-label="Stundenzettel Summen">
    {employeeTotals.map((item) => <div key={item.employeeName}><span>{item.employeeName}</span><strong>{formatDuration(item.minutes)}</strong></div>)}
    <div className="timesheet-grand-total"><span>Gesamtdauer</span><strong>{formatDuration(grandTotal)}</strong></div>
  </div>
}

export default function TimesheetPage({ session }) {
  const management = MANAGEMENT.has(session.role)
  const today = berlinDate(new Date())
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [employees, setEmployees] = useState([])
  const [userId, setUserId] = useState('')
  const [actual, setActual] = useState({ rows: [], error: '' })
  const [planned, setPlanned] = useState({ rows: [], error: '' })
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [editor, setEditor] = useState(null)
  const sessionUserId = session.userId || session.id || ''

  const employeeNames = useMemo(() => {
    const names = new Map()
    for (const employee of employees) names.set(String(employee.userId || employee.id || ''), employee.fullName || 'Mitarbeiter')
    if (sessionUserId) names.set(String(sessionUserId), session.fullName || 'Mitarbeiter')
    return names
  }, [employees, session.fullName, sessionUserId])

  const rows = useMemo(() => mergeTimesheetRows(actual.rows, planned.rows), [actual.rows, planned.rows])
  const closedRows = useMemo(() => rows.filter((row) => !row.open), [rows])

  const loadDirectory = useCallback(async () => {
    if (!management) return
    try {
      const data = await requestJson('/api/registrations')
      setEmployees(data.employees || [])
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    }
  }, [management])

  const loadActual = useCallback(async () => {
    try {
      const historyTo = addDateDays(to, 1)
      const params = new URLSearchParams({ resource: 'history', from, to: historyTo })
      if (management && userId) params.set('userId', userId)
      const data = await requestJson(`/api/attendance?${params}`)
      const rows = buildActualSessions(data.entries || [], employeeNames).filter((row) => row.date >= from && row.date <= to)
      setActual({ rows, error: '' })
    } catch (error) {
      setActual({ rows: [], error: error.message })
    }
  }, [employeeNames, from, management, to, userId])

  const loadPlanned = useCallback(async () => {
    try {
      const data = await requestJson(`/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      let entries = (data.entries || []).filter((entry) => entry.status !== 'draft')
      if (management && userId) entries = entries.filter((entry) => String(entry.employeeUserId || '') === userId)
      if (!management) entries = entries.filter((entry) => String(entry.employeeUserId || '') === String(sessionUserId) && entry.status === 'published')
      setPlanned({ rows: buildPlannedRows(entries, employeeNames), error: '' })
    } catch (error) {
      setPlanned({ rows: [], error: error.message })
    }
  }, [employeeNames, from, management, sessionUserId, to, userId])

  const reload = useCallback(async () => {
    setBusy('load')
    await Promise.all([loadActual(), loadPlanned()])
    setBusy('')
  }, [loadActual, loadPlanned])

  useEffect(() => { loadDirectory() }, [loadDirectory])
  useEffect(() => { reload() }, [reload])

  function openNewActual() {
    setEditor({
      mode: 'new', employeeUserId: userId || '', date: to || today,
      start: '07:00', end: '17:00', pauseMinutes: '0', scheduleId: null, objectId: null,
    })
  }

  function openExisting(row) {
    const plannedOnly = row.source === 'planned'
    setEditor({
      mode: plannedOnly ? 'planned' : 'edit',
      row,
      employeeUserId: row.userId,
      date: row.date,
      start: plannedOnly ? row.start : timeForInput(row.clockInAt),
      end: plannedOnly ? row.end : timeForInput(row.clockOutAt),
      pauseMinutes: String(plannedOnly ? row.pauseMinutes || 0 : row.breakMinutes || 0),
      scheduleId: row.scheduleId || row.id || null,
      objectId: row.objectId || null,
    })
  }

  async function saveEditor(event) {
    event.preventDefault()
    if (!editor) return
    const pauseMinutes = Number(editor.pauseMinutes)
    if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0) return setNotice({ tone: 'error', text: 'Die Pause muss eine ganze Minute ab 0 sein.' })
    const start = dateTimeFromInputs(editor.date, editor.start)
    const end = editor.end ? dateTimeFromInputs(editor.date, editor.end, true, editor.start) : null
    if (!start) return setNotice({ tone: 'error', text: 'Bitte einen gültigen Arbeitsbeginn eintragen.' })
    if (editor.mode !== 'edit' && !end) return setNotice({ tone: 'error', text: 'Bei einem neuen Stundenzettel ist ein Arbeitsende erforderlich.' })
    if (end && end <= start) return setNotice({ tone: 'error', text: 'Das Arbeitsende muss nach dem Arbeitsbeginn liegen.' })
    if (end) {
      const grossMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
      if (pauseMinutes > grossMinutes) return setNotice({ tone: 'error', text: 'Die Pause darf nicht länger als die Arbeitszeit sein.' })
    }
    if (editor.mode !== 'edit' && !editor.employeeUserId) return setNotice({ tone: 'error', text: 'Bitte einen Mitarbeiter auswählen.' })

    setBusy('save')
    setNotice(null)
    try {
      if (editor.mode === 'edit') {
        const currentPause = Number(editor.row.breakMinutes || 0)
        if (!end && pauseMinutes !== currentPause) throw new Error('Bei einem noch offenen Dienst kann die Pause erst zusammen mit einem Arbeitsende geändert werden.')
        await requestJson('/api/attendance-time-edit', {
          method: 'POST',
          body: JSON.stringify({
            clockInEventId: editor.row.clockInEventId,
            clockOutEventId: editor.row.clockOutEventId || null,
            clockInAt: start.toISOString(),
            clockOutAt: end ? end.toISOString() : null,
            pauseMinutes,
            reason: 'Bearbeitung im Stundenzettel',
          }),
        })
        setNotice({ tone: 'success', text: 'Arbeitszeit wurde aktualisiert.' })
      } else {
        await requestJson('/api/attendance-time-create', {
          method: 'POST',
          body: JSON.stringify({
            userId: editor.employeeUserId,
            clockInAt: start.toISOString(),
            clockOutAt: end.toISOString(),
            pauseMinutes,
            scheduleId: editor.scheduleId || null,
            objectId: editor.objectId || null,
          }),
        })
        setNotice({ tone: 'success', text: editor.mode === 'planned' ? 'Dienstplanzeit wurde als bearbeiteter Stundenzettel übernommen.' : 'Arbeitszeit wurde eingetragen.' })
      }
      setEditor(null)
      await loadActual()
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  async function exportTimesheet(format) {
    setBusy(`export-${format}`)
    setNotice(null)
    try {
      const expected = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'
      const { blob, filename } = await requestBlob('/api/timesheet-reports', {
        from, to, userIds: userId ? [userId] : [], format, scope: 'unified',
      }, expected)
      downloadBlob(blob, filename)
      setNotice({ tone: 'success', text: 'Stundenzettel wurde erstellt.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  return <div className="timesheet-page">
    <section className="panel filter-panel timesheet-filter">
      <div className="page-heading"><div><h2>Stundenzettel</h2><p>Dienstplanstunden werden automatisch übernommen. Erfasste oder bearbeitete Arbeitszeiten ersetzen die geplanten Werte.</p></div></div>
      <div className="filter-grid">
        <label>Von<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Bis<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        {management && <label>Mitarbeiter<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Alle Mitarbeiter</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label>}
        <button className="primary-button" type="button" disabled={busy === 'load'} onClick={reload}>{busy === 'load' ? 'Wird geladen …' : 'Zeitraum anzeigen'}</button>
      </div>
    </section>

    {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
    {actual.error && <InlineNotice tone="warning">Die gebuchten Arbeitszeiten konnten nicht geladen werden. Dienstplanstunden werden trotzdem angezeigt. {actual.error}</InlineNotice>}
    {planned.error && <InlineNotice tone="error">{planned.error}</InlineNotice>}

    {editor && management && <section className="panel editor-panel timesheet-editor">
      <div className="page-heading"><div><h2>{editor.mode === 'edit' ? 'Arbeitszeit bearbeiten' : editor.mode === 'planned' ? 'Dienstplanzeit übernehmen und bearbeiten' : 'Arbeitszeit eintragen'}</h2><p>Beginn, Ende und Pause werden im Stundenzettel gespeichert.</p></div><button type="button" className="secondary-button compact" onClick={() => setEditor(null)}>Schließen</button></div>
      <form className="schedule-form" onSubmit={saveEditor}>
        <div className="form-grid three">
          {editor.mode === 'new' && <label>Mitarbeiter<select required value={editor.employeeUserId} onChange={(event) => setEditor((current) => ({ ...current, employeeUserId: event.target.value }))}><option value="">Bitte wählen</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label>}
          <label>Datum<input type="date" required value={editor.date} onChange={(event) => setEditor((current) => ({ ...current, date: event.target.value }))} /></label>
          <label>Beginn<input type="time" required value={editor.start} onChange={(event) => setEditor((current) => ({ ...current, start: event.target.value }))} /></label>
          <label>Ende<input type="time" required={editor.mode !== 'edit' || Boolean(editor.row?.clockOutEventId)} value={editor.end} onChange={(event) => setEditor((current) => ({ ...current, end: event.target.value }))} /></label>
          <label>Pause in Minuten<input type="number" min="0" step="1" required value={editor.pauseMinutes} onChange={(event) => setEditor((current) => ({ ...current, pauseMinutes: event.target.value }))} /></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy === 'save'}>{busy === 'save' ? 'Wird gespeichert …' : 'Speichern'}</button><button type="button" className="secondary-button" onClick={() => setEditor(null)}>Abbrechen</button></div>
      </form>
    </section>}

    <section className="panel">
      <div className="page-heading"><div><h2>Arbeitszeiten</h2><p>Alle Stunden der ausgewählten Person stehen hier vor dem PDF-Export zusammen.</p></div>{management && <button className="primary-button compact" type="button" onClick={openNewActual}>Arbeitszeit eintragen</button>}</div>
      {management && <div className="timesheet-actions"><button className="secondary-button" type="button" disabled={busy.startsWith('export-')} onClick={() => exportTimesheet('pdf')}>Stundenzettel PDF</button><button className="secondary-button" type="button" disabled={busy.startsWith('export-')} onClick={() => exportTimesheet('xlsx')}>Stundenzettel Excel</button></div>}

      {rows.length ? <>
        <div className="timesheet-card-grid unified-timesheet-list">{rows.map((row, index) => <article className="timesheet-card" key={`${row.clockInEventId || row.scheduleId || row.id || row.date}-${index}`}>
          <header><div><strong>{formatDate(row.date, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</strong>{management && <span>{row.employeeName}</span>}</div><span className={`status ${row.open || row.source === 'planned' ? 'status-warning' : 'status-success'}`}>{row.open ? 'Offen' : row.source === 'planned' ? 'Aus Dienstplan' : 'Erfasst'}</span></header>
          <div className="timesheet-values"><div><span>Beginn</span><strong>{row.start || '–'}</strong></div><div><span>Ende</span><strong>{row.end || '–'}</strong></div><div><span>Pause</span><strong>{row.source === 'planned' ? row.pauseMinutes : row.breakMinutes || 0} Min.</strong></div><div><span>Dauer</span><strong>{row.open ? '–' : formatDuration(row.netMinutes)}</strong></div><div className="timesheet-wide-value"><span>Einsatzort</span><strong>{row.location || '–'}</strong></div><div className="timesheet-wide-value"><span>Arbeitsbereich</span><strong>{row.workArea || '–'}</strong></div></div>
          {management && <footer><span>{row.source === 'planned' ? 'Noch keine Ist-Zeit gebucht' : 'Im Stundenzettel gespeichert'}</span><button className="secondary-button compact" type="button" onClick={() => openExisting(row)}>Bearbeiten</button></footer>}
        </article>)}</div>
        <Summary rows={closedRows} />
      </> : <div className="empty-state">In diesem Zeitraum wurden keine Dienstplan- oder Arbeitszeiten gefunden.</div>}
    </section>
  </div>
}
