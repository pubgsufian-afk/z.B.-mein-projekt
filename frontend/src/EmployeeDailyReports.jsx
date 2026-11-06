import { useCallback, useEffect, useMemo, useState } from 'react'
import './employee-daily-reports.css'

const MAX_REPORT_WORDS = 1000

function berlinToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/u).filter(Boolean).length
}

function germanTimestamp(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '–'
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Der Tagesbericht konnte nicht verarbeitet werden.')
  return data
}

async function downloadOwnPdf(reportId) {
  const response = await fetch(`/api/daily-reports-pdf?id=${encodeURIComponent(reportId)}`, {
    credentials: 'same-origin', cache: 'no-store',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || 'Der PDF-Download ist fehlgeschlagen.')
  }
  const blob = await response.blob()
  const contentType = response.headers.get('content-type') || ''
  const signature = String.fromCharCode(...new Uint8Array(await blob.slice(0, 5).arrayBuffer()))
  if (!contentType.includes('application/pdf') || signature !== '%PDF-') throw new Error('Die PDF-Datei ist ungültig.')
  const header = response.headers.get('content-disposition') || ''
  const filename = (header.match(/filename="?([^";]+)"?/i)?.[1] || 'Tagesbericht.pdf').replace(/[\\/]/g, '-')
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

export default function EmployeeDailyReports() {
  const [text, setText] = useState('')
  const [date, setDate] = useState(berlinToday)
  const [reports, setReports] = useState([])
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const words = useMemo(() => wordCount(text), [text])
  const overLimit = words > MAX_REPORT_WORDS

  const load = useCallback(async (selectedDate) => {
    setBusy('list')
    try {
      const data = await requestJson(`/api/daily-reports?date=${encodeURIComponent(selectedDate)}`)
      setReports(Array.isArray(data.reports) ? data.reports : [])
      setNotice(null)
    } catch (error) {
      setReports([])
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy((current) => current === 'list' ? '' : current)
    }
  }, [])

  useEffect(() => { load(date) }, [date, load])

  async function submit(event) {
    event.preventDefault()
    if (!words || overLimit || busy) return
    if (!window.confirm('Bericht jetzt verbindlich absenden? Danach kannst du ihn nicht mehr bearbeiten oder löschen.')) return
    setBusy('send')
    setNotice(null)
    try {
      await requestJson('/api/daily-reports', { method: 'POST', body: JSON.stringify({ text: text.trim() }) })
      setText('')
      const today = berlinToday()
      setDate(today)
      const data = await requestJson(`/api/daily-reports?date=${encodeURIComponent(today)}`)
      setReports(Array.isArray(data.reports) ? data.reports : [])
      setNotice({ tone: 'success', text: 'Dein Tagesbericht wurde erfolgreich an die Verwaltung übermittelt. Du kannst ihn nicht mehr verändern oder löschen.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy('')
    }
  }

  async function download(report) {
    setBusy(report.id)
    setNotice(null)
    try { await downloadOwnPdf(report.id) }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }

  return <div className="employee-report-page">
    <section className="panel employee-report-compose">
      <div className="page-heading"><div><h2>Tagesbericht melden</h2><p>Besondere Ereignisse, Mängel und Übergaben direkt an die Verwaltung melden.</p></div></div>
      <form onSubmit={submit}>
        <label htmlFor="employee-daily-report-text">Deine Meldung</label>
        <textarea
          id="employee-daily-report-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Was ist passiert? Wo war es? Welche Maßnahmen wurden durchgeführt? …"
          rows={7}
          required
          maxLength={20000}
        />
        <div className="employee-report-form-bottom">
          <span className={overLimit ? 'employee-report-count error' : 'employee-report-count'}>{words.toLocaleString('de-DE')} / 1.000 Wörter</span>
          <button type="submit" className="primary-button" disabled={Boolean(busy) || !words || overLimit}>{busy === 'send' ? 'Wird gesendet …' : 'Bericht verbindlich absenden'}</button>
        </div>
        <p className="employee-report-disclaimer">Nach dem Absenden ist dein Bericht schreibgeschützt. Nur Administratoren dürfen ihn bearbeiten oder löschen. Dein Name sowie Datum und Uhrzeit werden automatisch erfasst.</p>
      </form>
      {notice && <p className={`employee-report-notice ${notice.tone}`} role="status">{notice.text}</p>}
    </section>
    <section className="panel employee-report-history">
      <div className="page-heading"><div><h2>Meine gesendeten Berichte</h2><p>Hier siehst du ausschließlich die Berichte, die du selbst eingereicht hast.</p></div></div>
      <div className="employee-report-filter">
        <label htmlFor="employee-report-date">Datum anzeigen
          <input id="employee-report-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => load(date)}>Aktualisieren</button>
      </div>
      {busy === 'list' ? <p className="employee-report-muted">Berichte werden geladen …</p>
        : reports.length ? <div className="employee-report-list">{reports.map((report) => <article className="employee-report-item" key={report.id}>
          <header><strong>{report.authorName || 'Mitarbeiter'}</strong><span>Gesendet: {germanTimestamp(report.createdAt)}</span></header>
          <p>{report.text}</p>
          {report.updatedAt && <small>Von der Verwaltung zuletzt bearbeitet: {germanTimestamp(report.updatedAt)}</small>}
          <div className="employee-report-item-footer">
            <span className="employee-report-locked">Schreibgeschützt · gesendet</span>
            <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => download(report)}>{busy === report.id ? 'PDF wird geladen …' : 'Eigenen Bericht als PDF'}</button>
          </div>
        </article>)}</div>
          : <p className="employee-report-muted">Für diesen Tag hast du keine Berichte abgesendet.</p>}
    </section>
  </div>
}
