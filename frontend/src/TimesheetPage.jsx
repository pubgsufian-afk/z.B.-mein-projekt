import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildActualSessions, buildPlannedRows, sumMinutes, totalsByEmployee } from './timesheet-utils.js'
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

function formatClock(value) {
  if (!value) return '–'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(date)
    : '–'
}

function formatDuration(minutes) {
  const total = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  return `${hours}:${String(rest).padStart(2, '0')} Std.`
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

function Summary({ rows, label }) {
  const employeeTotals = totalsByEmployee(rows)
  const grandTotal = sumMinutes(rows)
  return <div className="timesheet-summary" aria-label={`${label} Summen`}>
    {employeeTotals.map((item) => <div key={item.employeeName}><span>{item.employeeName}</span><strong>{formatDuration(item.minutes)}</strong></div>)}
    <div className="timesheet-grand-total"><span>Gesamtsumme</span><strong>{formatDuration(grandTotal)}</strong></div>
  </div>
}

export default function TimesheetPage({ session }) {
  const management = MANAGEMENT.has(session.role)
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [employees, setEmployees] = useState([])
  const [userId, setUserId] = useState('')
  const [actual, setActual] = useState({ rows: [], error: '' })
  const [planned, setPlanned] = useState({ rows: [], error: '' })
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [editor, setEditor] = useState(null)

  const employeeNames = useMemo(() => {
    const names = new Map()
    for (const employee of employees) names.set(String(employee.userId || employee.id || ''), employee.fullName || 'Mitarbeiter')
    if (session.userId) names.set(String(session.userId), session.fullName || 'Mitarbeiter')
    return names
  }, [employees, session.fullName, session.userId])

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
      const params = new URLSearchParams({ resource: 'history', from, to })
      if (management && userId) params.set('userId', userId)
      const data = await requestJson(`/api/attendance?${params}`)
      setActual({ rows: buildActualSessions(data.entries || [], employeeNames), error: '' })
    } catch (error) {
      setActual({ rows: [], error: error.message })
    }
  }, [employeeNames, from, management, to, userId])

  const loadPlanned = useCallback(async () => {
    try {
      const data = await requestJson(`/api/schedule-v2?resource=entries&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      let entries = (data.entries || []).filter((entry) => entry.status !== 'draft')
      if (management && userId) entries = entries.filter((entry) => String(entry.employeeUserId || '') === userId)
      if (!management) entries = entries.filter((entry) => String(entry.employeeUserId || '') === String(session.userId || '') && entry.status === 'published')
      setPlanned({ rows: buildPlannedRows(entries, employeeNames), error: '' })
    } catch (error) {
      setPlanned({ rows: [], error: error.message })
    }
  }, [employeeNames, from, management, session.userId, to, userId])

  const reload = useCallback(async () => {
    setBusy('load')
    await Promise.all([loadActual(), loadPlanned()])
    setBusy('')
  }, [loadActual, loadPlanned])

  useEffect(() => { loadDirectory() }, [loadDirectory])
  useEffect(() => { reload() }, [reload])

  function openNewActual() {
    setEditor({
      mode: 'new',
      employeeUserId: userId || '',
      date: to || today,
      start: '07:00',
      end: '17:00',
      pauseMinutes: '0',
    })
  }

  function openExisting(row) {
    setEditor({
      mode: 'edit',
      row,
      employeeUserId: row.userId,
      date: row.date,
      start: timeForInput(row.clockInAt),
      end: timeForInput(row.clockOutAt),
      pauseMinutes: String(row.breakMinutes || 0),
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
    if (editor.mode === 'new' && !end) return setNotice({ tone: 'error', text: 'Bei einem neuen Stundenzettel ist ein Arbeitsende erforderlich.' })
    if (end && end <= start) return setNotice({ tone: 'error', text: 'Das Arbeitsende muss nach dem Arbeitsbeginn liegen.' })
    if (end) {
      const grossMinutes = Math.round((end.getTime() - start.getTime()) / 60000)
      if (pauseMinutes > grossMinutes) return setNotice({ tone: 'error', text: 'Die Pause darf nicht länger als die Arbeitszeit sein.' })
    }
    if (editor.mode === 'new' && !editor.employeeUserId) return setNotice({ tone: 'error', text: 'Bitte einen Mitarbeiter auswählen.' })

    setBusy('save')
    setNotice(null)
    try {
      if (editor.mode === 'new') {
        await requestJson('/api/attendance-time-create', {
          method: 'POST',
          body: JSON.stringify({
            userId: editor.employeeUserId,
            clockInAt: start.toISOString(),
            clockOutAt: end.toISOString(),
            pauseMinutes,
          }),
        })
        setNotice({ tone: 'success', text: 'Arbeitszeit wurde eingetragen.' })
      } else {
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
      }
      setEditor(null)
      await loadActual()
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  async function exportReport({ scope, format }) {
    setBusy(`${scope}-${format}`)
    setNotice(null)
    try {
      const expected = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'
      const { blob, filename } = await requestBlob('/api/timesheet-reports', {
        from,
        to,
        userIds: userId ? [userId] : [],
        scope,
        format,
      }, expected)
      downloadBlob(blob, filename)
      setNotice({ tone: 'success', text: 'Datei wurde erstellt.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  return <div className="timesheet-page">
    <section className="panel filter-panel timesheet-filter">
      <div className="page-heading"><div><h2>Stundenzettel</h2><p>Tatsächliche Arbeitszeiten und geplante Dienstplanstunden bleiben getrennt.</p></div></div>
      <div className="filter-grid">
        <label>Von<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Bis<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        {management && <label>Mitarbeiter<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Alle Mitarbeiter</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label>}
        <button className="primary-button" type="button" disabled={busy === 'load'} onClick={reload}>{busy === 'load' ? 'Wird geladen …' : 'Zeitraum anzeigen'}</button>
      </div>
    </section>

    {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}

    {editor && management && <section className="panel editor-panel timesheet-editor">
      <div className="page-heading"><div><h2>{editor.mode === 'new' ? 'Arbeitszeit eintragen' : 'Arbeitszeit bearbeiten'}</h2><p>Beginn, Ende und Pause werden direkt im Stundenzettel gespeichert.</p></div><button type="button" className="secondary-button compact" onClick={() => setEditor(null)}>Schließen</button></div>
      <form className="schedule-form" onSubmit={saveEditor}>
        <div className="form-grid three">
          {editor.mode === 'new' && <label>Mitarbeiter<select required value={editor.employeeUserId} onChange={(event) => setEditor((current) => ({ ...current, employeeUserId: event.target.value }))}><option value="">Bitte wählen</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label>}
          <label>Datum<input type="date" required value={editor.date} onChange={(event) => setEditor((current) => ({ ...current, date: event.target.value }))} /></label>
          <label>Beginn<input type="time" required value={editor.start} onChange={(event) => setEditor((current) => ({ ...current, start: event.target.value }))} /></label>
          <label>Ende<input type="time" required={editor.mode === 'new' || Boolean(editor.row?.clockOutEventId)} value={editor.end} onChange={(event) => setEditor((current) => ({ ...current, end: event.target.value }))} /></label>
          <label>Pause in Minuten<input type="number" min="0" step="1" required value={editor.pauseMinutes} onChange={(event) => setEditor((current) => ({ ...current, pauseMinutes: event.target.value }))} /></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy === 'save'}>{busy === 'save' ? 'Wird gespeichert …' : 'Speichern'}</button><button type="button" className="secondary-button" onClick={() => setEditor(null)}>Abbrechen</button></div>
      </form>
    </section>}

    <div className="timesheet-sections">
      <section className="panel">
        <div className="page-heading"><div><h2>Arbeitsstunden – tatsächlich</h2><p>Gestempelte und manuell ergänzte Arbeitszeiten.</p></div>{management && <button className="primary-button compact" type="button" onClick={openNewActual}>Arbeitszeit eintragen</button>}</div>
        {management && <div className="timesheet-actions"><button className="secondary-button" type="button" onClick={() => exportReport({ scope: 'actual', format: 'pdf' })}>Ist-Stunden PDF</button><button className="secondary-button" type="button" onClick={() => exportReport({ scope: 'actual', format: 'xlsx' })}>Ist-Stunden Excel</button></div>}
        {actual.error ? <InlineNotice tone="error">{actual.error}</InlineNotice> : actual.rows.length ? <>
          <div className="timesheet-card-grid actual-timesheet-list">{actual.rows.map((row, index) => <article className="timesheet-card" key={`${row.clockInEventId || row.clockInAt}-${index}`}><header><div><strong>{formatDate(row.date, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</strong>{management && <span>{row.employeeName}</span>}</div><span className={`status ${row.open ? 'status-warning' : 'status-success'}`}>{row.open ? 'Offen' : 'Abgeschlossen'}</span></header><div className="timesheet-values"><div><span>Beginn</span><strong>{formatClock(row.clockInAt)}</strong></div><div><span>Ende</span><strong>{formatClock(row.clockOutAt)}</strong></div><div><span>Pause</span><strong>{row.breakMinutes} Min.</strong></div><div><span>Netto</span><strong>{row.open ? '–' : formatDuration(row.netMinutes)}</strong></div></div><footer><span>{row.location || '–'}</span>{management && <button className="secondary-button compact" type="button" onClick={() => openExisting(row)}>Bearbeiten</button>}</footer></article>)}</div>
          <Summary rows={actual.rows.filter((row) => !row.open)} label="Tatsächliche Arbeitsstunden" />
        </> : <div className="empty-state">In diesem Zeitraum wurden keine Arbeitszeiten gefunden.</div>}
      </section>

      <section className="panel">
        <div className="page-heading"><div><h2>Dienstplanstunden – geplant</h2><p>Nur geplante Soll-Stunden aus freigegebenen Diensten.</p></div></div>
        {management && <div className="timesheet-actions"><button className="secondary-button" type="button" onClick={() => exportReport({ scope: 'planned', format: 'pdf' })}>Dienstplanstunden PDF</button><button className="secondary-button" type="button" onClick={() => exportReport({ scope: 'planned', format: 'xlsx' })}>Dienstplanstunden Excel</button></div>}
        {planned.error ? <InlineNotice tone="error">{planned.error}</InlineNotice> : planned.rows.length ? <>
          <div className="timesheet-card-grid planned-timesheet-list">{planned.rows.map((row) => <article className="timesheet-card" key={row.id || `${row.userId}-${row.date}-${row.start}`}><header><div><strong>{formatDate(row.date, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</strong>{management && <span>{row.employeeName}</span>}</div><strong>{row.start}–{row.end}</strong></header><div className="timesheet-values"><div><span>Pause</span><strong>{row.pauseMinutes} Min.</strong></div><div><span>Geplant netto</span><strong>{formatDuration(row.netMinutes)}</strong></div><div className="timesheet-wide-value"><span>Einsatzort</span><strong>{row.location}</strong></div><div className="timesheet-wide-value"><span>Arbeitsbereich</span><strong>{row.workArea || '–'}</strong></div></div></article>)}</div>
          <Summary rows={planned.rows} label="Geplante Dienstplanstunden" />
        </> : <div className="empty-state">In diesem Zeitraum wurden keine freigegebenen Dienstplanstunden gefunden.</div>}
      </section>
    </div>
  </div>
}
