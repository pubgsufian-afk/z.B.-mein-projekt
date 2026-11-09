import { useCallback, useEffect, useMemo, useState } from 'react'
import './PrivateOwnerAudit.css'

const CATEGORY_OPTIONS = [
  ['', 'Alle Bereiche'],
  ['Dienstplan', 'Dienstplan'],
  ['Arbeitszeiten', 'Arbeitszeiten'],
  ['Stundenzettel', 'Stundenzettel'],
  ['Mitarbeiter', 'Mitarbeiter'],
  ['Berichte', 'Berichte'],
  ['Einsatzorte', 'Einsatzorte'],
  ['Firmendaten', 'Firmendaten'],
  ['Portalverwaltung', 'Portalverwaltung'],
]

function berlinDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(date)
}

function csvCell(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ')
  return '"' + text.replace(/"/g, '""') + '"'
}

function downloadCsv(events) {
  const head = ['Datum/Uhrzeit', 'Admin', 'Konto-ID', 'Bereich', 'Aktion', 'Betroffenes Objekt', 'Beschreibung', 'Vorher', 'Nachher']
  const rows = events.map((event) => [
    berlinDateTime(event.occurredAt),
    event.actorName || event.actorEmail || event.actorId,
    event.actorId,
    event.category,
    event.action,
    event.entityId,
    event.summary,
    event.before ? JSON.stringify(event.before) : '',
    event.after ? JSON.stringify(event.after) : '',
  ])
  const csv = '\uFEFF' + [head, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'HABUN-Privater-Aenderungsverlauf.csv'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Detail({ label, data }) {
  if (!data || !Object.keys(data).length) return null
  return <div className="private-audit-detail"><strong>{label}</strong><pre>{JSON.stringify(data, null, 2)}</pre></div>
}

export default function PrivateOwnerAudit({ accountId }) {
  const [events, setEvents] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [warnings, setWarnings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [lastUpdated, setLastUpdated] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ resource: 'events' })
      if (search.trim()) params.set('q', search.trim())
      if (category) params.set('category', category)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const response = await fetch('/api/private-owner-audit?' + params, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'Der Verlauf konnte nicht geladen werden.')
      if (!Array.isArray(data.events)) throw new Error('Ungültige Verlaufsdaten.')
      setEvents(data.events)
      setWarnings(data.warnings || [])
      setLastUpdated(new Date().toISOString())
    } catch (cause) {
      setEvents([])
      setError(cause.message || 'Unbekannter Fehler')
    } finally { setLoading(false) }
  }, [category, from, search, to])

  useEffect(() => { refresh() }, [refresh])
  const counts = useMemo(() => new Set(events.map((event) => event.actorId)).size, [events])

  return <div className="private-audit-page">
    <div className="page-heading">
      <div>
        <h2>Mein privater Änderungsverlauf</h2>
        <p>Nur für deinen persönlichen Zugang – niemand mit einer anderen Konto-ID kann diesen Bereich abrufen.</p>
      </div>
      <button className="secondary-button" type="button" disabled={loading} onClick={refresh}>Aktualisieren</button>
    </div>
    <div className="private-audit-summary">
      <section className="panel"><small>Gefundene Aktivitäten</small><strong>{events.length}</strong><span>Bis zu 500 aktuelle Einträge pro Suche</span></section>
      <section className="panel"><small>Beteiligte Konten</small><strong>{counts}</strong><span>Mit eindeutigem Benutzerkonto</span></section>
      <section className="panel"><small>Privater Zugang</small><strong>Geschützt</strong><span>Nur deine einmalig gebundene Konto-ID</span></section>
    </div>

    <section className="panel private-audit-controls">
      <h3>Aktivitäten durchsuchen</h3>
      <div className="private-audit-fields">
        <label>Suche nach Admin oder Änderung
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Konto-ID, Aktion ..." />
        </label>
        <label>Bereich
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Von
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>Bis
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} />
        </label>
      </div>
      <div className="private-audit-toolbar">
        <button type="button" className="secondary-button" onClick={() => { setSearch(''); setCategory(''); setFrom(''); setTo('') }}>Filter zurücksetzen</button>
        <button type="button" className="primary-button" disabled={loading || events.length === 0} onClick={() => downloadCsv(events)}>Angezeigte Einträge als CSV</button>
      </div>
      {lastUpdated && <p className="private-audit-muted">Zuletzt geladen: {berlinDateTime(lastUpdated)} · Uhrzeit Deutschland</p>}
    </section>

    {!!error && <div role="alert" className="private-audit-error">{error}</div>}
    {warnings.length > 0 && <div role="status" className="private-audit-warning">{warnings.join(' ')}</div>}
    <section className="panel private-audit-activity">
      <div className="private-audit-section-head">
        <h3>Änderungen und Admin-Aktionen</h3>
        <span>{loading ? 'Lädt …' : events.length + ' Einträge'}</span>
      </div>
      {loading ? <p>Der geschützte Verlauf wird geladen …</p>
        : events.length === 0 ? <p>Keine protokollierten Änderungen zu diesen Filtern gefunden.</p>
          : <div className="private-audit-items">
              {events.map((event, index) => <article className="private-audit-item" key={event.source + '-' + event.id + '-' + index}>
                <div className="private-audit-item-head">
                  <div><strong>{event.actorName || event.actorEmail || 'Unbekannter Admin'}</strong><span>{berlinDateTime(event.occurredAt)}</span></div>
                  <span className="private-audit-chip">{event.category}</span>
                </div>
                <p><b>{event.action}</b>{event.summary ? ' · ' + event.summary : ''}</p>
                {event.entityId && <small>Objekt / Mitarbeiter: {event.entityId}</small>}
                <button type="button" className="private-audit-more" aria-expanded={expanded === index} onClick={() => setExpanded(expanded === index ? null : index)}>
                  {expanded === index ? 'Details schließen' : 'Details anzeigen'}
                </button>
                {expanded === index && <div className="private-audit-expanded">
                  <div><strong>Konto-ID:</strong> {event.actorId}</div>
                  <div><strong>Berechtigung:</strong> {event.actorRole || '–'}</div>
                  <div><strong>Quelle:</strong> {event.source || 'Portal'}</div>
                  <div className="private-audit-diff">
                    <Detail label="Vorher" data={event.before} />
                    <Detail label="Nachher / Details" data={event.after} />
                  </div>
                  {!event.before && !event.after && <p>Für diesen älteren Vorgang wurden keine Vorher-/Nachher-Werte gespeichert.</p>}
                </div>}
              </article>)}
            </div>}
    </section>
    <section className="private-audit-footnote">
      <strong>Dein persönlicher Zugang</strong>
      <p>Account-ID: <code>{accountId || 'Wird über die Anmeldung ermittelt'}</code></p>
      <p>Die Tabelle umfasst gespeicherte Admin-Aktivitäten und vorhandene technische Protokolle. Vorgänge, die früher nicht protokolliert wurden, lassen sich nicht rückwirkend rekonstruieren. Vertrauliche Zugangsdaten und Berichtstexte erscheinen nicht im Änderungsverlauf.</p>
    </section>
  </div>
}
