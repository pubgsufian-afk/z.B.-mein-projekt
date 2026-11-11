import { useCallback, useEffect, useMemo, useState } from 'react'
import './PrivateOwnerAudit.css'
import { describeAuditEvent, auditValue } from './private-audit-presentation.mjs'

const CATEGORY_OPTIONS = [
  ['', 'Alle Bereiche'],
  ['Dienstplan', 'Dienstplan'],
  ['Arbeitszeiten', 'Arbeitszeiten'],
  ['Stundenzettel', 'Stundenzettel'],
  ['Mitarbeiter', 'Mitarbeiter'],
  ['Berichte', 'Berichte'],
  ['Dokumente', 'Dokumente'],
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
  const head = ['Datum/Uhrzeit', 'Admin', 'Konto-ID', 'Bereich', 'Aktion', 'Betroffene Person', 'Was genau gemacht wurde', 'Vorher', 'Nachher']
  const rows = events.map((event) => [
    berlinDateTime(event.occurredAt),
    event.actorName || event.actorEmail || event.actorId,
    event.actorId,
    event.category,
    event.action,
    event.targetName || event.entityId,
    describeAuditEvent(event).title + ' ' + describeAuditEvent(event).changes.map((entry) => entry.label + ': ' + (entry.hasBefore ? entry.before : '–') + ' → ' + (entry.hasAfter ? entry.after : '–')).join('; '),
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

function shiftContext(event) {
  if (event.category !== 'Dienstplan') return ''
  const data = event.after?.date ? event.after : event.before || event.after || {}
  const parts = []
  if (data.date) parts.push(auditValue('date', data.date))
  if (data.start && data.end) parts.push(data.start + '–' + data.end + ' Uhr')
  else if (data.start) parts.push('ab ' + data.start + ' Uhr')
  else if (data.end) parts.push('bis ' + data.end + ' Uhr')
  if (data.workArea) parts.push(data.workArea)
  if (data.location) parts.push(data.location)
  return parts.join(' · ')
}

function SavedSnapshot({ title, data }) {
  if (!data || !Object.keys(data).length) return <p className="private-audit-muted">{title}: Nicht gespeichert.</p>
  return <div className="private-audit-snapshot">
    <strong>{title}</strong>
    {Object.entries(data)
      .filter(([key]) => !/password|passwort|token|secret|cookie|authorization|credential|content|body|attachment/i.test(key))
      .map(([key, value]) => <div key={key}><span>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}:</span> {auditValue(key, value)}</div>)}
  </div>
}

function ChangeLine({ change }) {
  return <div className="private-audit-change-row">
    <span className="private-audit-change-label">{change.label}</span>
    <div className="private-audit-change-values">
      {change.hasBefore && change.hasAfter
        ? <><span className="private-audit-old">{change.before}</span><span className="private-audit-arrow" aria-hidden="true">→</span><strong>{change.after}</strong></>
        : change.hasAfter
          ? <strong>{change.after}</strong>
          : <><span className="private-audit-old">{change.before}</span><strong>Entfernt</strong></>}
    </div>
  </div>
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
              {events.map((event, index) => {
                const presentation = describeAuditEvent(event)
                const opened = expanded === index
                const affectedShift = shiftContext(event)
                return <article className="private-audit-item" key={event.source + '-' + event.id + '-' + index}>
                  <div className="private-audit-item-head">
                    <div><strong>{event.actorName || event.actorEmail || 'Unbekannter Admin'}</strong><span>{berlinDateTime(event.occurredAt)}</span></div>
                    <span className="private-audit-chip">{event.category}</span>
                  </div>
                  <h4 className="private-audit-sentence">{presentation.title}</h4>
                  {event.targetName
                    ? <p className="private-audit-target"><strong>Betroffen:</strong> {event.targetName}</p>
                    : event.category === 'Mitarbeiter'
                      ? <p className="private-audit-target">Der Mitarbeitername ist in diesem älteren Eintrag nicht mehr verfügbar.</p>
                      : null}
                  {affectedShift && <p className="private-audit-target"><strong>Betroffener Dienst:</strong> {affectedShift}</p>}
                  {presentation.changes.length
                    ? <div className="private-audit-changes">
                        {(opened ? presentation.changes : presentation.changes.slice(0, 3)).map((change) => <ChangeLine key={change.key} change={change} />)}
                        {!opened && presentation.changes.length > 3 && <p className="private-audit-muted">{presentation.changes.length - 3} weitere Änderungen in den Details</p>}
                      </div>
                    : <p className="private-audit-muted">Für diese Aktion enthält das gespeicherte Protokoll keine konkreten Änderungen. Nicht erfasste frühere Werte lassen sich nicht zuverlässig nachträglich ermitteln.</p>}
                  {presentation.changes.length > 0 && !event.before && event.after && <p className="private-audit-muted">Es wurde nur der neue Zustand gespeichert; frühere Werte sind für diesen Eintrag nicht vorhanden.</p>}
                  <button type="button" className="private-audit-more" aria-expanded={opened} onClick={() => setExpanded(opened ? null : index)}>
                    {opened ? 'Details schließen' : 'Weitere Informationen'}
                  </button>
                  {opened && <div className="private-audit-expanded">
                    <div><strong>Aktion:</strong> {event.action}</div>
                    <div><strong>Durchgeführt von:</strong> {event.actorName || event.actorEmail || 'Unbekannt'}</div>
                    <div><strong>Rolle des handelnden Kontos:</strong> {auditValue('role', event.actorRole) || '–'}</div>
                    {event.targetName && <div><strong>Betroffener Mitarbeiter:</strong> {event.targetName}</div>}
                    {event.summary && !event.summary.startsWith('POST /api/') && <div><strong>Begründung / Hinweis:</strong> {event.summary}</div>}
                    <details className="private-audit-technical">
                      <summary>Alle gespeicherten Vorher-/Nachher-Werte</summary>
                      <SavedSnapshot title="Vorher" data={event.before} />
                      <SavedSnapshot title="Nachher" data={event.after} />
                    </details>
                    <details className="private-audit-technical">
                      <summary>Technische Angaben anzeigen</summary>
                      <div><strong>Admin-Konto-ID:</strong> {event.actorId}</div>
                      {event.entityId && <div><strong>Datensatz-ID:</strong> {event.entityId}</div>}
                      <div><strong>Quelle:</strong> {event.source || 'Portal'}</div>
                    </details>
                  </div>}
                </article>
              })}
            </div>}
    </section>
    <section className="private-audit-footnote">
      <strong>Dein persönlicher Zugang</strong>
      <p>Account-ID: <code>{accountId || 'Wird über die Anmeldung ermittelt'}</code></p>
      <p>Die Tabelle umfasst gespeicherte Admin-Aktivitäten und vorhandene technische Protokolle. Vorgänge, die früher nicht protokolliert wurden, lassen sich nicht rückwirkend rekonstruieren. Vertrauliche Zugangsdaten und Berichtstexte erscheinen nicht im Änderungsverlauf.</p>
    </section>
  </div>
}
