import { useCallback, useEffect, useMemo, useState } from 'react'
import './employee-self-service.css'

const PDF = 'application/pdf'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TYPES = { contract: 'Arbeitsvertrag', payslip: 'Lohnabrechnung', other: 'Sonstiges' }
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
const DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024
const LARGE_CHUNK_BYTES = 2 * 1024 * 1024
const documentSizeLabel = (bytes) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024)) + ' MB'
const documentFileError = (selected) => {
  if (!selected) return ''
  if (selected.size > MAX_DOCUMENT_BYTES) {
    return 'Die ausgewählte PDF ist ' + documentSizeLabel(selected.size) + ' groß. Erlaubt sind höchstens 50 MB. Bitte die PDF vor dem Zustellen verkleinern.'
  }
  if (selected.size < 5 || (!/\.pdf$/i.test(selected.name) && selected.type !== PDF)) {
    return 'Bitte eine gültige PDF-Datei auswählen.'
  }
  return ''
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (body.message) throw new Error(body.message)
    const uploadingDocument = options.body instanceof FormData
    if (uploadingDocument && response.status === 413) {
      throw new Error('Die PDF ist für den Upload zu groß. Bitte auf höchstens 50 MB verkleinern.')
    }
    if (uploadingDocument && response.status === 400) {
      throw new Error('Der Upload wurde vom Server abgelehnt. Bitte PDF-Datei und Größe (maximal 50 MB) prüfen.')
    }
    throw new Error('Die Anfrage ist fehlgeschlagen (HTTP ' + response.status + '). Bitte erneut versuchen.')
  }
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
// Large PDFs are split into 2 MiB private requests because Netlify buffered
// functions reject larger binary bodies. The recipient and sender are verified
// afresh on the server; no document is made publicly reachable.
async function uploadLargeEmployeeDocument(file, metadata, onProgress) {
  const begin = await requestJson('/api/employee-documents-large?action=begin', {
    method: 'POST', body: JSON.stringify({
      employeeUserId: metadata.employeeUserId,
      documentType: metadata.documentType,
      title: metadata.title,
      fileName: file.name,
      byteSize: file.size,
    }),
  })
  const id = String(begin.uploadId || '')
  const chunkSize = Number(begin.chunkSize)
  const count = Number(begin.chunkCount)
  if (!/^[0-9a-f-]{36}$/i.test(id) || chunkSize !== LARGE_CHUNK_BYTES || count !== Math.ceil(file.size / LARGE_CHUNK_BYTES)) {
    throw new Error('Der sichere Upload konnte nicht vorbereitet werden.')
  }
  try {
    for (let index = 0; index < count; index++) {
      const part = file.slice(index * LARGE_CHUNK_BYTES, Math.min((index + 1) * LARGE_CHUNK_BYTES, file.size))
      let succeeded = false
      for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
        try {
          const response = await fetch('/api/employee-documents-large?action=chunk&id=' + encodeURIComponent(id) +
            '&index=' + index, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream' },
            body: part,
          })
          const result = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(result.message || 'Ein Teil der PDF konnte nicht übertragen werden (HTTP ' + response.status + ').')
          succeeded = true
        } catch (error) {
          if (attempt === 1) throw error
        }
      }
      onProgress('PDF wird sicher übertragen: ' + Math.round((index + 1) * 100 / count) + ' %')
    }
    onProgress('PDF wird überprüft und zugestellt …')
    await requestJson('/api/employee-documents-large?action=finish&id=' + encodeURIComponent(id), {
      method: 'POST', body: JSON.stringify({}),
    })
  } catch (error) {
    await requestJson('/api/employee-documents-large?action=cancel&id=' + encodeURIComponent(id), {
      method: 'POST', body: JSON.stringify({}),
    }).catch(() => {})
    throw error
  }
}

async function downloadLargeEmployeeDocument(id, onProgress) {
  const key = encodeURIComponent(id)
  const info = await requestJson('/api/employee-documents-large?action=info&id=' + key)
  const count = Number(info.chunkCount)
  const size = Number(info.byteSize)
  const sha = String(info.sha256 || '')
  if (!Number.isInteger(count) || count < 1 || count > 25 || !Number.isInteger(size) || size > MAX_DOCUMENT_BYTES
      || size < 5 || !/^[a-f0-9]{64}$/.test(sha) || Number(info.chunkSize) !== LARGE_CHUNK_BYTES) {
    throw new Error('Die PDF-Daten konnten nicht sicher überprüft werden.')
  }
  const parts = new Array(count)
  for (let start = 0; start < count; start += 3) {
    await Promise.all(Array.from({ length: Math.min(3, count - start) }, (_, offset) => start + offset)
      .map(async (index) => {
        const response = await fetch('/api/employee-documents-large?action=part&id=' + key + '&index=' + index, {
          credentials: 'same-origin', cache: 'no-store',
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.message || 'Der PDF-Download ist fehlgeschlagen (HTTP ' + response.status + ').')
        }
        if (!String(response.headers.get('content-type') || '').includes('application/octet-stream')) {
          throw new Error('Die Antwort enthält keinen gültigen PDF-Dateiteil.')
        }
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength !== Math.min(LARGE_CHUNK_BYTES, size - index * LARGE_CHUNK_BYTES)) {
          throw new Error('Ein PDF-Dateiteil ist unvollständig.')
        }
        parts[index] = bytes
      }))
    onProgress('PDF wird geladen: ' + Math.round(Math.min(start + 3, count) * 100 / count) + ' %')
  }
  const blob = new Blob(parts, { type: PDF })
  const bytes = await blob.arrayBuffer()
  if (String.fromCharCode(...new Uint8Array(bytes, 0, 5)) !== '%PDF-') {
    throw new Error('Die PDF-Datei ist beschädigt.')
  }
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((v) => v.toString(16).padStart(2, '0')).join('')
  if (actual !== sha) throw new Error('Die PDF-Datei konnte nicht sicher überprüft werden.')
  const filename = String(info.fileName || 'HABUN-Dokument.pdf').replace(/[\/\\]/g, '-')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
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
  const [uploadProgress, setUploadProgress] = useState('')
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
  function chooseDocument(event) {
    const selected = event.target.files?.[0] || null
    setFile(selected)
    setSuccess('')
    setMessage(documentFileError(selected))
  }
  async function upload(event) {
    event.preventDefault()
    if (!isAdmin || !file) return
    const invalid = documentFileError(file)
    if (invalid) { setMessage(invalid); return }
    setBusy('upload'); setMessage(''); setSuccess('')
    try {
      if (file.size > DIRECT_UPLOAD_BYTES) {
        await uploadLargeEmployeeDocument(file, {
          employeeUserId: recipient, documentType: type, title: type === 'other' ? title.trim() : '',
        }, setUploadProgress)
      } else {
        const form = new FormData()
        form.append('employeeUserId', recipient)
        form.append('documentType', type)
        form.append('title', type === 'other' ? title.trim() : '')
        form.append('file', file)
        await requestJson('/api/employee-documents', { method: 'POST', body: form })
      }
      setTitle(''); setFile(null)
      const input = document.getElementById('employee-document-file')
      if (input) input.value = ''
      setSuccess('Das Dokument wurde für den ausgewählten Mitarbeiter bereitgestellt.')
      await load()
    } catch (error) { setMessage(error.message) }
    finally { setBusy(''); setUploadProgress('') }
  }
  async function download(id) {
    setBusy(id); setMessage(''); setUploadProgress('')
    try {
      const item = documents.find((entry) => entry.id === id)
      if (Number(item?.byteSize) > DIRECT_UPLOAD_BYTES) {
        await downloadLargeEmployeeDocument(id, setUploadProgress)
      } else {
        await requestDownload('/api/employee-documents?action=download&id=' + encodeURIComponent(id), null, PDF)
      }
      await load()
    } catch (error) { setMessage(error.message) }
    finally { setBusy(''); setUploadProgress('') }
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
      {uploadProgress && <p className="self-service-hint" role="status">{uploadProgress}</p>}
      {isAdmin && <form className="self-service-upload" onSubmit={upload}>
        <label>Mitarbeiter
          <select required value={recipient} onChange={(e) => setRecipient(e.target.value)}>
            <option value="">Mitarbeiter auswählen</option>
            {employees.map((e) => <option key={e.userId || e.id} value={e.userId || e.id}>{recipientLabel(e)}</option>)}
          </select>
        </label>
        <label>Dokumentart
          <select value={type} onChange={(e) => { setType(e.target.value); setTitle('') }}>
            {Object.entries(TYPES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        {type === 'other' && <label>Bezeichnung<input required maxLength={180} value={title} placeholder="Bezeichnung des Dokuments" onChange={(e) => setTitle(e.target.value)} /></label>}
        <label>PDF-Datei (maximal 50 MB)<input id="employee-document-file" type="file" accept="application/pdf,.pdf" required onChange={chooseDocument} />
          {file && <small className="self-service-file-size">Dateigröße: {documentSizeLabel(file.size)} {documentFileError(file) ? '– bitte kleinere PDF auswählen' : '– bereit zum Hochladen'}</small>}
        </label>
        <button className="primary-button" disabled={Boolean(busy) || !recipient || !file || Boolean(documentFileError(file)) || (type === 'other' && !title.trim())}>{busy === 'upload' ? 'Wird sicher zugestellt …' : 'Dokument zustellen'}</button>
      </form>}
    </section>
    <section className="panel">
      <h2>{isAdmin ? 'Versendete Dokumente' : 'Meine Dokumente'}</h2>
      {documents.length ? <div className="self-service-list">
        {documents.map((doc) => <article className="self-service-entry" key={doc.id}>
          <div><strong>{doc.title}</strong>
            <span>{TYPES[doc.documentType] || 'Dokument'} · {new Date(doc.publishedAt).toLocaleDateString('de-DE')}</span>
            <span>Gesendet von: {doc.senderName || 'Absender nicht zugeordnet'}</span>
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
