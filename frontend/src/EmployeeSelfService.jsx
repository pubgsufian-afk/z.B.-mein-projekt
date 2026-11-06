import { useCallback, useEffect, useMemo, useState } from 'react'
import './employee-self-service.css'

const PDF = 'application/pdf'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TYPES = { contract: 'Arbeitsvertrag', payslip: 'Lohnabrechnung', other: 'Sonstiges Dokument' }

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'Die Anfrage ist fehlgeschlagen.')
  return body
}
async function requestDownload(path, payload, expectedType) {
  const response = await fetch(path, {
    method: payload ? 'POST' : 'GET',
    credentials: 'same-origin', cache: 'no-store',
    ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || 'Die Datei konnte nicht geladen werden.')
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes(expectedType)) throw new Error('Unerwarteter Dateityp.')
  const blob = await response.blob()
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  const pdfHeader = String.fromCharCode(...head)
  if (expectedType === PDF && pdfHeader !== '%PDF-') throw new Error('Die PDF-Datei ist beschädigt.')
  if (expectedType === XLSX && !(head[0] === 0x50 && head[1] === 0x4b)) throw new Error('Die Excel-Datei ist beschädigt.')
  const disposition = response.headers.get('content-disposition') || ''
  const name = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'Habun-Dokument'
  const safeName = name.replace(/[\/\\]/g, '-')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
function berlinMonth() {
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const p = (type) => parts.find((entry) => entry.type === type)?.value
  return `${p('year')}-${p('month')}`
}
function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [year, number] = month.split('-').map(Number)
  if (number < 1 || number > 12) return null
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return { from: month + '-01', to: month + '-' + String(last).padStart(2, '0') }
}
function formatMinutes(input) {
  const minutes = Math.max(0, Math.round(Number(input) || 0))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} Std.`
}
function formatDay(value) {
  const date = new Date(String(value) + 'T12:00:00')
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : value
}
function notice(text, tone = 'error') {
  return text ? <p className={`self-service-notice self-service-${tone}`} role="status">{text}</p> : null
}

export function EmployeeTimesheetPage() {
  const [month, setMonth] = useState(berlinMonth)
  const [entries, setEntries] = useState([])
  const [monthlyEntries, setMonthlyEntries] = useState([])
  const [summary, setSummary] = useState(null)
  const [scope, setScope] = useState('monthly')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const range = useMemo(() => monthRange(month), [month])
  const load = useCallback(async () => {
    if (!range) return
    setBusy('loading')
    try {
      const params = new URLSearchParams(range)
      const data = await requestJson('/api/employee-timesheet?' + params)
      setEntries(Array.isArray(data.entries) ? data.entries : [])
      setMonthlyEntries(Array.isArray(data.monthlyEntries) ? data.monthlyEntries : [])
      setSummary(data.summary || null)
      setMessage('')
    } catch (error) {
      setEntries([])
      setMonthlyEntries([])
      setSummary(null)
      setMessage(error.message)
    } finally { setBusy('') }
  }, [range])
  useEffect(() => { load() }, [load])
  async function download(format) {
    if (!range) return
    setBusy(format)
    setMessage('')
    try {
      await requestDownload('/api/employee-timesheet', { ...range, format, scope }, format === 'pdf' ? PDF : XLSX)
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  return <div className="self-service-view">
    <section className="panel">
      <div className="page-heading"><div><h2>Meine Arbeitsstunden</h2><p>Deine Stundenübersicht und Stundenzettel zum Herunterladen</p></div></div>
      <div className="self-service-toolbar">
        <label>Monat <input aria-label="Monat auswählen" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <button className="secondary-button" disabled={Boolean(busy)} onClick={load}>Aktualisieren</button>
      </div>
      {notice(message)}
      <div className="self-service-metrics">
        <div><span>Stundenzettel der Verwaltung</span><strong>{formatMinutes(summary?.timesheetMinutes)}</strong><small>{summary?.timesheetEntries || 0} hinterlegte Einträge, inklusive Korrekturen und Dienstplanübernahmen</small></div>
        <div><span>Tatsächlich erfasst</span><strong>{formatMinutes(summary?.recordedMinutes)}</strong><small>{summary?.recordedShifts || 0} abgeschlossene Buchungen</small></div>
        <div><span>Nur im Dienstplan</span><strong>{formatMinutes(summary?.scheduledMinutes)}</strong><small>{summary?.scheduledShifts || 0} noch nicht durch Stempelzeiten ersetzte Dienste</small></div>
      </div>
      <p className="self-service-hint">Der Stundenzettel der Verwaltung berücksichtigt gespeicherte Korrekturen, kann aber auch aus dem Dienstplan übernommene Stunden enthalten. Erfasste Zeiten stammen aus der Stempeluhr. Die drei Summen sind unterschiedliche Sichtweisen und dürfen nicht zusammengerechnet werden.</p>
      <div className="self-service-export">
        <label>Für den Download
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="monthly">Stundenzettel der Verwaltung (inkl. Korrekturen)</option>
            <option value="actual">Nur erfasste Arbeitszeit</option>
            <option value="unified">Erfasst und Dienstplan (getrennt gekennzeichnet)</option>
            <option value="planned">Nur Dienstplan</option>
          </select>
        </label>
        <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => download('pdf')}>{busy === 'pdf' ? 'PDF wird erstellt …' : 'Stundenzettel PDF'}</button>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => download('xlsx')}>{busy === 'xlsx' ? 'Excel wird erstellt …' : 'Excel herunterladen'}</button>
      </div>
    </section>
    <section className="panel">
      <h2>Stundenzettel der Verwaltung</h2>
      <p className="self-service-hint">Gespeicherte Stunden einschließlich nachträglicher Korrekturen. Dienstplanübernahmen sind nicht automatisch eine Bestätigung der tatsächlich geleisteten Arbeit.</p>
      {monthlyEntries.length ? <div className="self-service-list">{monthlyEntries.map((entry, index) => <article className="self-service-entry self-service-hours-entry" key={'monthly-' + index + '-' + entry.date}>
        <div><strong>{formatDay(entry.date)}</strong><span>{entry.location || 'Einsatzort'} · {entry.workArea || 'Arbeitsbereich'}</span></div>
        <div><strong>{entry.start}–{entry.end}</strong><span>Pause: {entry.pauseMinutes || 0} Min.</span></div>
        <div className="self-service-entry-right"><strong>{formatMinutes(entry.netMinutes)}</strong><span className={entry.manualOverride || entry.source === 'manual' ? 'self-service-tag recorded' : 'self-service-tag'}>{entry.manualOverride || entry.source === 'manual' ? 'Korrigiert / manuell' : 'Dienstplanübernahme'}</span></div>
      </article>)}</div> : <p>Für diesen Monat sind noch keine Verwaltungs-Stundenzettel hinterlegt.</p>}
    </section>
    <section className="panel">
      <h2>Stempeluhr und Dienstplan im {month?.split('-').reverse().join('.') || 'Monat'}</h2>
      {busy === 'loading' ? <p>Arbeitsstunden werden geladen …</p>
        : entries.length ? <div className="self-service-list">
          {entries.map((entry, index) => <article className="self-service-entry self-service-hours-entry" key={entry.date + '-' + entry.start + '-' + index}>
            <div><strong>{formatDay(entry.date)}</strong><span>{entry.location || 'Einsatzort'} · {entry.workArea || 'Arbeitsbereich'}</span></div>
            <div><strong>{entry.start}–{entry.end}</strong><span>Pause: {entry.pauseMinutes || 0} Min.</span></div>
            <div className="self-service-entry-right"><strong>{formatMinutes(entry.netMinutes)}</strong><span className={entry.source === 'actual' ? 'self-service-tag recorded' : 'self-service-tag'}>{entry.source === 'actual' ? 'Erfasst' : 'Dienstplan'}</span></div>
          </article>)}
        </div> : <p>Keine Einträge für diesen Monat vorhanden.</p>}
    </section>
  </div>
}

export function EmployeeMailboxPage({ session }) {
  const isAdmin = session.role === 'owner' || session.role === 'admin'
  const [employees, setEmployees] = useState([])
  const [documents, setDocuments] = useState([])
  const [unread, setUnread] = useState(0)
  const [recipient, setRecipient] = useState('')
  const [type, setType] = useState('payslip')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState('')
  const names = useMemo(() => new Map(employees.map((e) => [String(e.userId || e.id), e.fullName])), [employees])
  // Duplicate display names are possible while accounts are being reconciled.
  // Make recipients distinguishable so an admin cannot unknowingly deliver
  // confidential payroll documents to the wrong account.
  const nameCounts = useMemo(() => {
    const counts = new Map()
    for (const employee of employees) {
      const key = String(employee.fullName || '').trim().toLocaleLowerCase('de-DE')
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [employees])
  const recipientLabel = (employee) => {
    const name = String(employee.fullName || 'Mitarbeiter').trim()
    const key = name.toLocaleLowerCase('de-DE')
    if ((nameCounts.get(key) || 0) < 2) return name
    const id = String(employee.userId || employee.id || '')
    return name + ' · Konto …' + id.slice(-8)
  }
  const load = useCallback(async () => {
    try {
      const data = await requestJson('/api/employee-documents')
      setDocuments(data.documents || [])
      setUnread(Number(data.unreadCount) || 0)
    } catch (error) { setMessage(error.message) }
  }, [])
  useEffect(() => {
    load()
    if (isAdmin) requestJson('/api/registrations')
      .then((data) => setEmployees((data.employees || []).filter((e) => e.status !== 'inactive' && (e.userId || e.id))))
      .catch((error) => setMessage(error.message))
  }, [isAdmin, load])
  async function upload(event) {
    event.preventDefault()
    if (!isAdmin || !file) return
    setBusy('upload'); setMessage(''); setSuccess('')
    try {
      const form = new FormData()
      form.append('employeeUserId', recipient)
      form.append('documentType', type)
      form.append('title', title)
      form.append('file', file)
      await requestJson('/api/employee-documents', { method: 'POST', body: form })
      setTitle(''); setFile(null)
      const input = document.getElementById('employee-document-file')
      if (input) input.value = ''
      setSuccess('Das Dokument wurde für den ausgewählten Mitarbeiter bereitgestellt.')
      await load()
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  async function download(id) {
    setBusy(id); setMessage('')
    try {
      await requestDownload('/api/employee-documents?action=download&id=' + encodeURIComponent(id), null, PDF)
      await load()
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  async function revoke(id) {
    if (!isAdmin || !window.confirm('Dieses Dokument wirklich für den Mitarbeiter zurückziehen? Der Vorgang wird protokolliert.')) return
    setBusy(id); setMessage(''); setSuccess('')
    try {
      await requestJson('/api/employee-documents', { method: 'DELETE', body: JSON.stringify({ id }) })
      setSuccess('Das Dokument wurde zurückgezogen.')
      await load()
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  return <div className="self-service-view">
    <section className="panel">
      <div className="page-heading"><div><h2>{isAdmin ? 'Mitarbeiterpostfach verwalten' : 'Mein Postfach'}</h2>
        <p>{isAdmin ? 'Verträge, Lohnabrechnungen und andere Dokumente einzeln und sicher zustellen' : 'Deine persönlichen Dokumente von der Verwaltung herunterladen'}</p></div></div>
      {!isAdmin && <p className="self-service-hint">Neue Dokumente: <strong>{unread}</strong>. Die Dokumente sind nur mit deinem freigeschalteten Konto zugänglich.</p>}
      {notice(message)}
      {notice(success, 'success')}
      {isAdmin && <form className="self-service-upload" onSubmit={upload}>
        <label>Mitarbeiter
          <select required value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">Mitarbeiter auswählen</option>
            {employees.map((e) => <option key={e.userId || e.id} value={e.userId || e.id}>{recipientLabel(e)}</option>)}
          </select>
        </label>
        <label>Dokumentart
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        <label>Bezeichnung<input required maxLength={180} value={title} placeholder="z. B. Lohnabrechnung Oktober 2026" onChange={(e) => setTitle(e.target.value)} /></label>
        <label>PDF-Datei (maximal 4 MB)<input id="employee-document-file" type="file" accept="application/pdf,.pdf" required onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        <button className="primary-button" disabled={Boolean(busy) || !recipient || !file || !title.trim()}>{busy === 'upload' ? 'Wird sicher zugestellt …' : 'Dokument zustellen'}</button>
      </form>}
    </section>
    <section className="panel">
      <h2>{isAdmin ? 'Versendete Dokumente' : 'Meine Dokumente'}</h2>
      {documents.length ? <div className="self-service-list">
        {documents.map((doc) => <article className="self-service-entry" key={doc.id}>
          <div><strong>{doc.title}</strong>
            <span>{TYPES[doc.documentType] || 'Dokument'} · {new Date(doc.publishedAt).toLocaleDateString('de-DE')}</span>
            {isAdmin && <span>Empfänger: {names.get(String(doc.employeeUserId)) || 'Mitarbeiter'}</span>}
          </div>
          <div className="self-service-document-actions">
            {doc.revokedAt
              ? <span className="self-service-tag">Zurückgezogen</span>
              : <>
                {!doc.firstOpenedAt && <span className="self-service-tag recorded">Neu</span>}
                <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => download(doc.id)}>PDF herunterladen</button>
                {isAdmin && <button type="button" className="danger-outline compact" disabled={Boolean(busy)} onClick={() => revoke(doc.id)}>Zurückziehen</button>}
              </>}
          </div>
        </article>)}
      </div> : <p>Im Postfach sind noch keine Dokumente vorhanden.</p>}
    </section>
  </div>
}
