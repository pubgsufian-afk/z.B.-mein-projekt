import { useCallback, useEffect, useMemo, useState } from 'react'
import './time-off.css'

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])
const STATUS = { pending: 'Offen', approved: 'Genehmigt', rejected: 'Abgelehnt', withdrawn: 'Zurückgezogen', revoked: 'Aufgehoben' }

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Die Anfrage konnte nicht bearbeitet werden.')
  return data
}

const today = () => {
  const p = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).formatToParts(new Date())
  const v = (name) => p.find((x) => x.type === name)?.value || ''
  return v('year') + '-' + v('month') + '-' + v('day')
}
const showDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || '')
  ? date.slice(8, 10) + '.' + date.slice(5, 7) + '.' + date.slice(0, 4) : '–'

export default function TimeOffPage({ session }) {
  const management = MANAGEMENT.has(session.role)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [requests, setRequests] = useState([])
  const [daysOff, setDaysOff] = useState([])
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState('')
  const [responseNotes, setResponseNotes] = useState({})

  const load = useCallback(async () => {
    try {
      const result = await requestJson('/api/time-off?resource=all&from=' + today())
      setRequests(result.requests || [])
      setDaysOff(result.daysOff || [])
    } catch (error) { setNotice({ tone: 'error', message: error.message }) }
  }, [])
  useEffect(() => { load() }, [load])

  async function act(action, payload, key = action) {
    setBusy(key)
    setNotice(null)
    try {
      const result = await requestJson('/api/time-off', { method: 'POST', body: JSON.stringify({ action, ...payload }) })
      await load()
      return result
    } catch (error) {
      setNotice({ tone: 'error', message: error.message })
      return null
    } finally { setBusy('') }
  }

  async function submit(event) {
    event.preventDefault()
    if (!date || reason.trim().length < 3) {
      setNotice({ tone: 'error', message: 'Datum und Grund (mindestens 3 Zeichen) sind erforderlich.' })
      return
    }
    const result = await act('request', { date, reason }, 'request')
    if (result) {
      setDate(''); setReason('')
      setNotice({ tone: 'success', message: 'Dein Freiwunsch wurde übermittelt. Bis zur Genehmigung gilt weiterhin der Dienstplan.' })
    }
  }

  async function decide(item, decision) {
    if (decision === 'approve' && !window.confirm('Diesen Freiwunsch genehmigen und den Tag für die Dienstplanung sperren?')) return
    const result = await act('decide', { id: item.id, decision, note: responseNotes[item.id] || '' }, item.id)
    if (result) setNotice({ tone: 'success', message: decision === 'approve' ? 'Freiwunsch genehmigt. Der Mitarbeiter ist an diesem Tag nicht mehr einplanbar.' : 'Freiwunsch wurde abgelehnt.' })
  }

  async function revoke(day) {
    if (!window.confirm('Dienstfrei für ' + day.employeeName + ' am ' + showDate(day.date) + ' aufheben?')) return
    const result = await act('remove-day-off', { employeeUserId: day.employeeUserId, date: day.date }, 'remove-' + day.employeeUserId + day.date)
    if (result) setNotice({ tone: 'success', message: 'Dienstfrei wurde aufgehoben. Der Mitarbeiter ist wieder einplanbar.' })
  }

  const open = useMemo(() => requests.filter((item) => item.status === 'pending'), [requests])
  const closed = useMemo(() => requests.filter((item) => item.status !== 'pending'), [requests])

  return <div className="time-off-page">
    <header className="time-off-heading">
      <div><h2>Freiwünsche & Dienstfrei</h2><p>Freie Tage anfragen, prüfen und verbindlich im Dienstplan kennzeichnen.</p></div>
      <button type="button" className="secondary-button compact" onClick={load} disabled={Boolean(busy)}>Aktualisieren</button>
    </header>
    {notice && <div className={'time-off-notice ' + notice.tone} role="status">{notice.message}</div>}

    <section className="panel time-off-panel">
      <h3>Freiwunsch einreichen</h3>
      <p className="time-off-hint">Ein Freiwunsch ist zunächst nur eine Anfrage. Erst nach Genehmigung steht im persönlichen Dienstplan „Dienstfrei“.</p>
      <form onSubmit={submit} className="time-off-form">
        <label>Gewünschter freier Tag<input type="date" value={date} min={today()} required onChange={(event) => setDate(event.target.value)} /></label>
        <label>Grund oder Termin<textarea rows="3" minLength="3" maxLength="500" required placeholder="z. B. privater Termin am Nachmittag" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="submit" className="primary-button" disabled={Boolean(busy)}>{busy === 'request' ? 'Wird gesendet …' : 'Freiwunsch senden'}</button>
      </form>
    </section>

    {management && <section className="panel time-off-panel">
      <h3>Offene Freiwünsche ({open.length})</h3>
      <p className="time-off-hint">Einsatzleitung, Administratoren und Inhaber können Anfragen genehmigen oder ablehnen. Bei vorhandenen Diensten verhindert das System die Genehmigung und löscht nichts automatisch.</p>
      {open.length ? <div className="time-off-stack">{open.map((item) => <article className="time-off-request" key={item.id}>
        <header><div><strong>{item.employeeName}</strong><span>{showDate(item.date)}</span></div><span className="time-off-state pending">Offen</span></header>
        <p className="time-off-reason">{item.reason}</p>
        {item.hasShift && <p className="time-off-warning">An diesem Tag ist bereits eine Schicht eingetragen. Erst den Dienstplan klären.</p>}
        <label>Antwort an Mitarbeiter (optional)<textarea rows="2" maxLength="500" value={responseNotes[item.id] || ''} onChange={(event) => setResponseNotes((state) => ({ ...state, [item.id]: event.target.value }))} /></label>
        <div className="time-off-actions">
          <button type="button" className="primary-button compact" disabled={Boolean(busy) || item.hasShift} onClick={() => decide(item, 'approve')}>Genehmigen</button>
          <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => decide(item, 'reject')}>Ablehnen</button>
        </div>
      </article>)}</div> : <p className="time-off-empty">Derzeit keine offenen Freiwünsche.</p>}
    </section>}

    <section className="panel time-off-panel">
      <h3>{management ? 'Eingetragene freie Tage' : 'Meine bestätigten freien Tage'}</h3>
      {daysOff.length ? <div className="time-off-stack">{daysOff.map((item) => <article className="time-off-day" key={item.employeeUserId + ':' + item.date}>
        <div><strong>{showDate(item.date)} – Dienstfrei</strong><small>{management ? item.employeeName : 'Keine Schicht geplant'} · {item.source === 'request' ? 'Freiwunsch genehmigt' : 'Von der Dienstplanung eingetragen'}</small></div>
        {management && <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => revoke(item)}>Aufheben</button>}
      </article>)}</div> : <p className="time-off-empty">Keine bestätigten freien Tage im angezeigten Zeitraum.</p>}
    </section>

    <section className="panel time-off-panel">
      <h3>{management ? 'Bearbeitete Anfragen' : 'Meine Freiwünsche'}</h3>
      {!management && open.length > 0 && <div className="time-off-stack">{open.map((item) => <article className="time-off-request" key={item.id}>
        <header><div><strong>{showDate(item.date)}</strong><span>{item.reason}</span></div><span className="time-off-state pending">Offen</span></header>
        <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={async () => { const result = await act('withdraw', { id: item.id }, item.id); if (result) setNotice({ tone: 'success', message: 'Die Anfrage wurde zurückgezogen.' }) }}>Zurückziehen</button>
      </article>)}</div>}
      {closed.length ? <div className="time-off-stack">{closed.map((item) => <article className="time-off-request" key={item.id}>
        <header><div><strong>{management ? item.employeeName + ' · ' : ''}{showDate(item.date)}</strong><span>{item.reason}</span></div><span className={'time-off-state ' + item.status}>{STATUS[item.status] || item.status}</span></header>
        {item.decisionNote && <p className="time-off-response">Rückmeldung: {item.decisionNote}</p>}
      </article>)}</div> : <p className="time-off-empty">Noch keine bearbeiteten Anfragen.</p>}
      {management && <p className="time-off-hint">Anzeige der letzten 300 Anfragen. Freie Tage kannst du auch unmittelbar im Dienstplan erstellen.</p>}
    </section>
  </div>
}
