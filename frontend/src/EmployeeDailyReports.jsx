import { useMemo, useState } from 'react'
import './employee-daily-reports.css'

const MAX_REPORT_WORDS = 1000

function wordCount(text) {
  return String(text || '').trim().split(/\s+/u).filter(Boolean).length
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

export default function EmployeeDailyReports() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const words = useMemo(() => wordCount(text), [text])
  const overLimit = words > MAX_REPORT_WORDS

  async function submit(event) {
    event.preventDefault()
    if (!words || overLimit || busy) return
    if (!window.confirm('Bericht jetzt verbindlich absenden? Danach kannst du ihn nicht mehr bearbeiten oder löschen.')) return
    setBusy('send')
    setNotice(null)
    try {
      await requestJson('/api/daily-reports', { method: 'POST', body: JSON.stringify({ text: text.trim() }) })
      setText('')
      setNotice({ tone: 'success', text: 'Dein Tagesbericht wurde an die Administratoren übermittelt. Nach dem Absenden ist er für Mitarbeiter nicht mehr einsehbar.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setBusy('')
    }
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
        <p className="employee-report-disclaimer">Nach dem Absenden können nur Administratoren den Bericht sehen, herunterladen, bearbeiten oder löschen. Mitarbeiter können auch ihre eigenen abgesendeten Berichte nicht mehr einsehen. Dein Name sowie Datum und Uhrzeit werden automatisch erfasst.</p>
      </form>
      {notice && <p className={`employee-report-notice ${notice.tone}`} role="status">{notice.text}</p>}
    </section>
  </div>
}
