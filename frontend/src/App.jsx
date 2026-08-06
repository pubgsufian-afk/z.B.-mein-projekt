import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AuthError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  requestPasswordRecovery,
  signup,
} from '@netlify/identity'

const ROLE_LABELS = {
  owner: 'Chef / Hauptadmin',
  admin: 'Admin',
  manager: 'Einsatzleiter',
  employee: 'Mitarbeiter',
  pending: 'Wartet auf Freigabe',
}

const MANAGEMENT = new Set(['owner', 'admin', 'manager'])
const ADMINISTRATION = new Set(['owner', 'admin'])

const NAVIGATION = [
  { key: 'overview', label: 'Übersicht', roles: ['owner', 'admin', 'manager'] },
  { key: 'attendance', label: 'Zeiterfassung', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'employees', label: 'Mitarbeiter', roles: ['owner', 'admin', 'manager'] },
  { key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager'] },
  { key: 'times', label: 'Zeiten', roles: ['owner', 'admin', 'manager'] },
  { key: 'worksites', label: 'Einsatzorte', roles: ['owner', 'admin'] },
  { key: 'corrections', label: 'Korrekturen', roles: ['owner', 'admin', 'manager'] },
  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },
  { key: 'settings', label: 'Einstellungen', roles: ['owner', 'admin'] },
]

async function apiJson(path, options = {}) {
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
  if (!response.ok) {
    const error = new Error(body.message || `Die Anfrage ist fehlgeschlagen (${response.status}).`)
    error.status = response.status
    error.code = body.code
    throw error
  }
  return body
}

async function apiBlob(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || `Die Datei konnte nicht erstellt werden (${response.status}).`)
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const filename = encoded ? decodeURIComponent(encoded) : plain || 'Habun-Bericht'
  return { blob: await response.blob(), filename: filename.replace(/[\\/]/g, '-') }
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

function mondayOf(value = new Date()) {
  const date = typeof value === 'string' ? new Date(`${value}T12:00:00`) : new Date(value)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function addDays(value, count) {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + count)
  return date.toISOString().slice(0, 10)
}

function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '–'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('de-DE', options).format(date) : '–'
}

function formatDateTime(value) {
  return formatDate(value, { dateStyle: 'short', timeStyle: 'short' })
}

function formatDuration(minutes) {
  const total = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  return `${hours}:${String(rest).padStart(2, '0')} Std.`
}

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-mark"><img src="/habun-logo.png" alt="Habun Security" /></span>
      {!compact && <div><strong>Habun Security</strong><span>Mitarbeiterportal</span></div>}
    </div>
  )
}

function Notice({ notice, onClose }) {
  if (!notice) return null
  return (
    <div className={`notice notice-${notice.tone || 'info'}`} role="status">
      <span>{notice.text}</span>
      {onClose && <button type="button" aria-label="Meldung schließen" onClick={onClose}>×</button>}
    </div>
  )
}

function Status({ tone = 'neutral', children }) {
  return <span className={`status status-${tone}`}>{children}</span>
}

function Empty({ children }) {
  return <div className="empty-state">{children}</div>
}

function AuthScreen({ notice, setNotice }) {
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', company: 'Habun Security', location: '', password: '' })
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      if (mode === 'login') {
        await login(form.email.trim().toLowerCase(), form.password)
        setNotice({ tone: 'success', text: 'Anmeldung erfolgreich.' })
      } else {
        await signup(form.email.trim().toLowerCase(), form.password, {
          full_name: form.fullName.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          location: form.location.trim(),
          requested_role: 'employee',
        })
        setNotice({ tone: 'success', text: 'Anfrage gesendet. Bitte bestätige deine E-Mail. Danach schaltet die Firma das Konto frei.' })
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof AuthError ? error.message : error.message || 'Anmeldung nicht möglich.' })
    } finally { setBusy(false) }
  }

  async function recover() {
    if (!form.email.trim()) return setNotice({ tone: 'error', text: 'Bitte zuerst die E-Mail-Adresse eintragen.' })
    setBusy(true)
    try {
      await requestPasswordRecovery(form.email.trim().toLowerCase())
      setNotice({ tone: 'success', text: 'Die E-Mail zum Zurücksetzen des Passworts wurde versendet.' })
    } catch { setNotice({ tone: 'error', text: 'Die Wiederherstellungs-E-Mail konnte nicht versendet werden.' }) }
    finally { setBusy(false) }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Brand />
        <div className="auth-copy">
          <h1>Arbeitszeiten und Dienstpläne sicher verwalten.</h1>
          <p>Ein geschütztes Portal für Habun Security – übersichtlich auf Handy und Computer.</p>
          <ul><li>Konten werden intern freigeschaltet</li><li>Rollen begrenzen jeden Zugriff</li><li>Mitarbeiter sehen nur eigene Daten</li></ul>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <Brand compact />
          <h2>{mode === 'login' ? 'Anmelden' : 'Registrierung anfragen'}</h2>
          <p className="muted">{mode === 'login' ? 'Mit dem freigeschalteten Firmenkonto anmelden.' : 'Nach der E-Mail-Bestätigung prüft ein Admin die Anfrage.'}</p>
          <div className="auth-tabs" role="tablist" aria-label="Anmeldung oder Registrierung">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Anmeldung</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Registrierung</button>
          </div>
          <form onSubmit={submit} className="form-stack">
            {mode === 'register' && <label>Vollständiger Name<input value={form.fullName} onChange={update('fullName')} required autoComplete="name" /></label>}
            <label>E-Mail-Adresse<input type="email" value={form.email} onChange={update('email')} required autoComplete="email" /></label>
            <label>Passwort<input type="password" minLength={10} value={form.password} onChange={update('password')} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
            {mode === 'register' && <>
              <div className="form-grid"><label>Firma<input value={form.company} onChange={update('company')} required /></label><label>Objekt / Einsatzort<input value={form.location} onChange={update('location')} required /></label></div>
              <label>Telefonnummer <span className="optional">optional</span><input type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" /></label>
            </>}
            <Notice notice={notice} />
            <button className="primary-button" disabled={busy}>{busy ? 'Bitte warten …' : mode === 'login' ? 'Sicher anmelden' : 'Anfrage absenden'}</button>
          </form>
          {mode === 'login' && <button className="text-button" type="button" onClick={recover} disabled={busy}>Passwort vergessen</button>}
          <p className="security-note">Keine öffentlichen Adminrechte. Freigaben erfolgen ausschließlich intern.</p>
        </div>
      </section>
    </main>
  )
}

function PendingScreen({ session, onLogout }) {
  return <main className="pending-page"><section className="pending-card"><Brand /><div className="pending-mark">✓</div><h1>Registrierung eingegangen</h1><p>Hallo {session.fullName || 'Mitarbeiter'}, dein Konto wartet auf die Freigabe durch Habun Security.</p><div className="pending-details"><div><span>Status</span><strong>Prüfung durch Admin</strong></div><div><span>Einsatzort</span><strong>{session.location || '–'}</strong></div></div><button className="secondary-button" onClick={onLogout}>Abmelden</button></section></main>
}

function PortalShell({ session, page, setPage, onLogout, children }) {
  const [drawer, setDrawer] = useState(false)
  const items = NAVIGATION.filter((item) => item.roles.includes(session.role))
  const title = items.find((item) => item.key === page)?.label || 'Übersicht'
  const navigate = (key) => { setPage(key); setDrawer(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (session.role === 'employee') {
    return (
      <div className="employee-kiosk-shell">
        <header className="employee-kiosk-header">
          <Brand />
          <button className="secondary-button compact" type="button" onClick={onLogout}>Abmelden</button>
        </header>
        <main className="employee-kiosk-main" aria-label="Mitarbeiter-Zeiterfassung">{children}</main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <button className={`drawer-backdrop ${drawer ? 'visible' : ''}`} aria-label="Menü schließen" onClick={() => setDrawer(false)} />
      <aside className={`sidebar ${drawer ? 'open' : ''}`}>
        <Brand />
        <nav aria-label="Hauptnavigation">
          {items.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => navigate(item.key)}><span className="nav-dot" />{item.label}</button>)}
        </nav>
        <div className="sidebar-footer"><Status tone="gold">{ROLE_LABELS[session.role]}</Status><button className="text-button light" onClick={onLogout}>Abmelden</button></div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <button className="hamburger-button" type="button" aria-label="Menü öffnen" onClick={() => setDrawer(true)}><span /><span /><span /></button>
          <div className="topbar-logo" aria-hidden="true"><Brand compact /></div>
          <div className="topbar-title"><h1>{title}</h1><p>Habun Security · Geschützter Firmenbereich</p></div>
          <div className="account-chip"><span>{session.fullName?.slice(0, 1)?.toUpperCase() || 'H'}</span><div><strong>{session.fullName}</strong><small>{ROLE_LABELS[session.role]}</small></div></div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  )
}

function PageHeader({ title, subtitle, action }) {
  return <div className="page-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>
}

function OverviewPage({ session, navigate }) {
  const [requests, setRequests] = useState([])
  const [schedule, setSchedule] = useState([])
  const [attendance, setAttendance] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const calls = [apiJson('/api/schedule-v2?resource=entries'), apiJson('/api/attendance?resource=state')]
        if (MANAGEMENT.has(session.role)) calls.push(apiJson('/api/registrations'))
        const [scheduleData, attendanceData, registrationData] = await Promise.all(calls)
        if (!active) return
        setSchedule(scheduleData.entries || [])
        setAttendance(attendanceData)
        setRequests(registrationData?.requests || [])
      } catch (error) { if (active) setNotice({ tone: 'error', text: error.message }) }
    })()
    return () => { active = false }
  }, [session.role])

  const today = new Date().toISOString().slice(0, 10)
  const todayShifts = schedule.filter((entry) => entry.date === today)
  return <>
    <Notice notice={notice} />
    <section className="metric-strip">
      <div><span>Heutige Dienste</span><strong>{todayShifts.length}</strong></div>
      <div><span>Offene Anfragen</span><strong>{MANAGEMENT.has(session.role) ? requests.length : '–'}</strong></div>
      <div><span>Arbeitsstatus</span><strong className={attendance?.phase === 'working' ? 'online' : ''}>{attendance?.phase === 'working' ? 'Läuft' : attendance?.phase === 'paused' ? 'Pause' : 'Bereit'}</strong></div>
      <div><span>Systemstatus</span><strong className="online">Geschützt</strong></div>
    </section>
    <section className="panel">
      <PageHeader title="Schnellzugriff" subtitle="Die wichtigsten Bereiche ohne Umwege." />
      <div className="quick-grid">
        <button onClick={() => navigate('attendance')}><strong>Digitale Zeiterfassung</strong><span>Arbeitszeit und Pausen bedienen</span></button>
        <button onClick={() => navigate('schedule')}><strong>Dienstplan</strong><span>Dienste ansehen oder planen</span></button>
        <button onClick={() => navigate('times')}><strong>Meine Zeiten</strong><span>Buchungen und Stunden prüfen</span></button>
        {MANAGEMENT.has(session.role) && <button onClick={() => navigate('reports')}><strong>Berichte</strong><span>PDF und Excel erstellen</span></button>}
      </div>
    </section>
    <section className="panel">
      <PageHeader title="Heute" subtitle="Geplante Dienste des heutigen Tages." />
      {todayShifts.length ? <div className="card-list">{todayShifts.map((shift) => <article className="compact-card" key={shift.id}><div><strong>{shift.employeeName || session.fullName}</strong><span>{shift.location} · {shift.workArea}</span></div><div className="right"><strong>{shift.start}–{shift.end}</strong><span>{shift.pauseMinutes || 0} Min. Pause</span></div></article>)}</div> : <Empty>Für heute ist noch kein Dienst eingetragen.</Empty>}
    </section>
  </>
}

function DigitalClock({ now }) {
  const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)
  return <div className="digital-clock-wrap"><time className="digital-clock" dateTime={now.toISOString()}>{time}</time><span>{formatDate(now, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span></div>
}

function actionLabel(action) {
  return action === 'clock-in' ? 'Arbeitsbeginn' : action === 'break-start' ? 'Pause begonnen' : action === 'break-end' ? 'Pause beendet' : 'Arbeitsende'
}

function AttendancePage({ session }) {
  const employeeOnly = session.role === 'employee'
  const [now, setNow] = useState(new Date())
  const [state, setState] = useState({ phase: 'idle', events: [], schedule: null })
  const [live, setLive] = useState([])
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await apiJson('/api/attendance?resource=state')
      setState(data)
      if (MANAGEMENT.has(session.role)) {
        const liveData = await apiJson('/api/attendance?resource=live')
        setLive(liveData.entries || [])
      }
      setNotice(null)
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [session.role])

  useEffect(() => { load() }, [load])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])

  async function getLocation() {
    if (!navigator.geolocation) return null
    return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    ))
  }

  async function record(action) {
    setBusy(action)
    setNotice(null)
    try {
      const needsLocation = action === 'clock-in' || action === 'clock-out'
      const location = needsLocation ? await getLocation() : null
      await apiJson('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          action,
          clientEventId: `att:${crypto.randomUUID()}`,
          clientOccurredAt: new Date().toISOString(),
          scheduleId: state.schedule?.id || null,
          objectId: state.schedule?.objectId || null,
          offlineCaptured: !navigator.onLine,
          location,
        }),
      })
      setNotice({ tone: 'success', text: `${actionLabel(action)} wurde gespeichert.` })
      await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }

  const phase = state.phase || 'idle'
  return <>
    <section className={`attendance-hero ${employeeOnly ? 'employee-attendance-hero' : ''}`}>
      <DigitalClock now={now} />
      <div className="attendance-shift">
        {employeeOnly ? <>
          <span>Arbeitsstatus</span>
          <strong>{phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : 'Bereit zum Start'}</strong>
          <p>Hier kannst du ausschließlich deine Arbeitszeit und Pause bedienen.</p>
        </> : <>
          <span>Heutiger Dienst</span>
          <strong>{state.schedule ? `${state.schedule.start || '–'}–${state.schedule.end || '–'}` : 'Kein Dienst veröffentlicht'}</strong>
          <p>{state.schedule ? `${state.schedule.location || '–'} · ${state.schedule.workArea || '–'}` : 'Der Dienstplan wurde für heute noch nicht freigegeben.'}</p>
        </>}
        <div className="attendance-state"><span className={`state-light ${phase}`} />{phase === 'working' ? 'Arbeitszeit läuft' : phase === 'paused' ? 'Pause läuft' : phase === 'completed' ? 'Dienst abgeschlossen' : 'Bereit zum Start'}</div>
      </div>
    </section>
    <Notice notice={notice} onClose={() => setNotice(null)} />
    <section className="panel attendance-controls-panel">
      <PageHeader title={employeeOnly ? 'Stempeluhr' : 'Zeit bedienen'} subtitle={employeeOnly ? 'Arbeitsbeginn, Pause und Arbeitsende.' : 'Der Standort wird nur bei Arbeitsbeginn und Arbeitsende abgefragt.'} />
      <div className="clock-actions">
        {phase === 'idle' && <button className="clock-button start" disabled={Boolean(busy)} onClick={() => record('clock-in')}><span>▶</span><strong>{busy ? 'Wird gespeichert …' : 'Arbeit beginnen'}</strong></button>}
        {phase === 'working' && <>
          <button className="clock-button pause" disabled={Boolean(busy)} onClick={() => record('break-start')}><span>Ⅱ</span><strong>Pause beginnen</strong></button>
          <button className="clock-button stop" disabled={Boolean(busy)} onClick={() => record('clock-out')}><span>■</span><strong>Arbeit beenden</strong></button>
        </>}
        {phase === 'paused' && <button className="clock-button start" disabled={Boolean(busy)} onClick={() => record('break-end')}><span>▶</span><strong>Pause beenden</strong></button>}
        {phase === 'completed' && <div className="completed-card"><strong>Dienst abgeschlossen</strong>{!employeeOnly && <span>Arbeitsbeginn {formatDateTime(state.clockInAt)} · Arbeitsende {formatDateTime(state.clockOutAt)}</span>}</div>}
      </div>
    </section>
    {!employeeOnly && <section className="panel">
      <PageHeader title="Heutige Buchungen" subtitle="Alle Aktionen in zeitlicher Reihenfolge." action={<button className="secondary-button compact" onClick={load}>Aktualisieren</button>} />
      {(state.events || []).length ? <div className="timeline">{state.events.map((event) => <div key={event.id || event.clientEventId}><span className={`timeline-dot ${event.action}`} /><div><strong>{actionLabel(event.action)}</strong><small>{formatDateTime(event.clientOccurredAt)}</small></div><Status tone={event.locationStatus === 'inside' ? 'success' : event.locationStatus === 'outside' ? 'warning' : 'neutral'}>{event.action.startsWith('break') ? 'ohne Standort' : event.locationStatus === 'inside' ? 'am Einsatzort' : event.locationStatus === 'outside' ? 'außerhalb' : 'Standort nicht verfügbar'}</Status></div>)}</div> : <Empty>Noch keine Buchung für heute.</Empty>}
    </section>}
    {MANAGEMENT.has(session.role) && <section className="panel"><PageHeader title="Live-Übersicht" subtitle="Aktuelle Buchungen der Mitarbeiter – keine dauerhafte Ortung." />{live.length ? <div className="responsive-table"><table><thead><tr><th>Mitarbeiter</th><th>Aktion</th><th>Zeit</th><th>Einsatzort</th><th>Status</th></tr></thead><tbody>{live.map((entry) => <tr key={entry.id}><td>{entry.employeeName || 'Mitarbeiter'}</td><td>{actionLabel(entry.action)}</td><td>{formatDateTime(entry.clientOccurredAt)}</td><td>{entry.workSiteName || '–'}</td><td><Status tone={entry.locationStatus === 'inside' ? 'success' : 'warning'}>{entry.locationStatus === 'inside' ? 'Im Bereich' : entry.locationStatus === 'outside' ? 'Außerhalb' : 'Nicht verfügbar'}</Status></td></tr>)}</tbody></table></div> : <Empty>Heute liegen noch keine Buchungen vor.</Empty>}</section>}
  </>
}

function EmployeesPage({ session }) {
  const [data, setData] = useState({ requests: [], employees: [], archived: [] })
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const canManage = ADMINISTRATION.has(session.role)
  const load = useCallback(async () => {
    try { setData(await apiJson('/api/registrations')); setNotice(null) }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [])
  useEffect(() => { load() }, [load])

  async function decide(id, action, role = 'employee') {
    setBusy(id)
    try {
      await apiJson('/api/registrations', { method: 'PATCH', body: JSON.stringify({ id, action, role }) })
      setNotice({ tone: 'success', text: action === 'approve' ? 'Konto wurde freigeschaltet.' : 'Anfrage wurde abgelehnt.' })
      await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }

  return <>
    <Notice notice={notice} />
    <section className="panel"><PageHeader title="Offene Registrierungen" subtitle={canManage ? 'Anfragen prüfen und mit der passenden Rolle freigeben.' : 'Nur Administration darf Konten freischalten.'} action={<button className="secondary-button compact" onClick={load}>Aktualisieren</button>} />
      {(data.requests || []).length ? <div className="card-list">{data.requests.map((request) => <article className="employee-card" key={request.id}><div><strong>{request.fullName}</strong><span>{request.email}</span><small>{request.location || 'Kein Einsatzort angegeben'}</small></div>{canManage && <div className="employee-actions"><select aria-label={`Rolle für ${request.fullName}`} defaultValue="employee" id={`role-${request.id}`}><option value="employee">Mitarbeiter</option><option value="manager">Einsatzleiter</option><option value="admin">Admin</option></select><button className="primary-button compact" disabled={busy === request.id} onClick={() => decide(request.id, 'approve', document.getElementById(`role-${request.id}`).value)}>Freischalten</button><button className="danger-outline compact" disabled={busy === request.id} onClick={() => decide(request.id, 'reject')}>Ablehnen</button></div>}</article>)}</div> : <Empty>Keine offenen Registrierungsanfragen.</Empty>}
    </section>
    <section className="panel"><PageHeader title="Aktive Mitarbeiter" subtitle="Auswahl und Planung erfolgen über den Namen." />{(data.employees || []).length ? <div className="employee-grid">{data.employees.map((employee) => <article key={employee.userId || employee.id}><div className="avatar">{employee.fullName?.slice(0, 1)?.toUpperCase() || 'M'}</div><strong>{employee.fullName}</strong><span>{employee.location || 'Kein fester Einsatzort'}</span><Status tone="success">Aktiv</Status></article>)}</div> : <Empty>Noch keine aktiven Mitarbeiter gefunden.</Empty>}</section>
  </>
}

function SchedulePage({ session }) {
  const management = MANAGEMENT.has(session.role)
  const [week, setWeek] = useState(mondayOf())
  const [entries, setEntries] = useState([])
  const [objects, setObjects] = useState([])
  const [employees, setEmployees] = useState([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const editorRef = useRef(null)
  const emptyForm = useMemo(() => ({ id: '', employeeUserId: '', employeeName: '', date: week, start: '07:00', end: '17:00', pauseMinutes: 30, objectId: '', location: '', workArea: '', note: '', repeatDays: [] }), [week])
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async () => {
    try {
      const from = week
      const to = addDays(week, 6)
      const calls = [apiJson(`/api/schedule-v2?resource=entries&from=${from}&to=${to}`), apiJson('/api/schedule-v2?resource=objects')]
      if (management) calls.push(apiJson('/api/registrations'))
      const [shiftData, objectData, employeeData] = await Promise.all(calls)
      setEntries(shiftData.entries || [])
      setObjects(objectData.objects || [])
      setEmployees(employeeData?.employees || [])
      setNotice(null)
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [week, management])
  useEffect(() => { load() }, [load])
  useEffect(() => { setForm((current) => current.id ? current : { ...emptyForm }) }, [emptyForm])

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  function startNew(date) {
    setForm({ ...emptyForm, date })
    setEditing(true)
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  function edit(entry) {
    setForm({ ...entry, repeatDays: [], pauseMinutes: Number(entry.pauseMinutes || 0) })
    setEditing(true)
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  async function save(event) {
    event.preventDefault()
    setBusy('save')
    try {
      const employee = employees.find((item) => String(item.userId || item.id) === form.employeeUserId)
      const object = objects.find((item) => item.id === form.objectId)
      const payload = {
        action: 'save', id: form.id || undefined,
        employeeUserId: form.employeeUserId,
        employeeName: employee?.fullName || form.employeeName,
        date: form.date, start: form.start, end: form.end,
        pauseMinutes: Number(form.pauseMinutes || 0), objectId: form.objectId || null,
        location: object?.name || form.location, workArea: form.workArea, note: form.note, status: 'draft',
      }
      const result = await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify(payload) })
      if (form.repeatDays?.length) {
        await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action: 'repeat', id: result.shift.id, dates: form.repeatDays }) })
      }
      setNotice({ tone: result.warnings?.length ? 'warning' : 'success', text: result.warnings?.length ? `Dienst gespeichert. ${result.warnings.length} Überschneidung(en) bitte prüfen.` : 'Dienst als Entwurf gespeichert.' })
      setEditing(false)
      setForm({ ...emptyForm })
      await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }

  async function post(action, extra = {}) {
    setBusy(action)
    try {
      await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action, week, ...extra }) })
      setNotice({ tone: 'success', text: action === 'publish' ? 'Der Wochenplan wurde freigegeben.' : 'Die Vorwoche wurde als Entwurf kopiert.' })
      await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }

  async function remove() {
    if (!form.id || !window.confirm('Diesen Dienst wirklich löschen?')) return
    setBusy('delete')
    try { await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action: 'delete', id: form.id }) }); setEditing(false); setNotice({ tone: 'success', text: 'Dienst wurde gelöscht.' }); await load() }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }

  return <>
    <Notice notice={notice} onClose={() => setNotice(null)} />
    <section className="panel schedule-toolbar"><div className="toolbar-row"><label>Woche ab<input type="date" value={week} onChange={(event) => setWeek(mondayOf(event.target.value))} /></label><div className="toolbar-actions"><button className="secondary-button" onClick={() => setWeek(mondayOf(addDays(week, -7)))}>‹ Vorherige</button><button className="secondary-button" onClick={() => setWeek(mondayOf())}>Aktuelle Woche</button><button className="secondary-button" onClick={() => setWeek(mondayOf(addDays(week, 7)))}>Nächste ›</button></div></div>{management && <div className="toolbar-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => post('copy-previous-week')}>Vorwoche kopieren</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => window.confirm('Diesen Wochenplan jetzt für Mitarbeiter freigeben?') && post('publish')}>Entwurf prüfen und freigeben</button></div>}</section>
    <div className="week-cards">{days.map((date) => { const dayEntries = entries.filter((entry) => entry.date === date); return <section className="day-card" key={date}><header><div><span>{formatDate(date, { weekday: 'long' })}</span><strong>{formatDate(date, { day: '2-digit', month: '2-digit' })}</strong></div>{management && <button aria-label={`Dienst am ${formatDate(date)} hinzufügen`} onClick={() => startNew(date)}>＋</button>}</header><div>{dayEntries.length ? dayEntries.map((entry) => <button className="shift-item" key={entry.id} onClick={() => management && edit(entry)}><strong>{entry.start}–{entry.end}</strong><span>{entry.employeeName}</span><small>{entry.location} · {entry.workArea}</small><em>{entry.pauseMinutes || 0} Min. Pause · {entry.status === 'published' ? 'Freigegeben' : 'Entwurf'}</em></button>) : <span className="day-empty">Kein Dienst</span>}</div></section> })}</div>
    {management && editing && <section className="panel editor-panel" ref={editorRef}><PageHeader title={form.id ? 'Dienst bearbeiten' : 'Dienst erstellen'} subtitle="Auf dem Handy in wenigen einfachen Feldern." action={<button className="secondary-button compact" onClick={() => setEditing(false)}>Schließen</button>} /><form className="schedule-form" onSubmit={save}><div className="form-grid three"><label>Mitarbeiter<select value={form.employeeUserId} onChange={update('employeeUserId')} required><option value="">Bitte wählen</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label><label>Datum<input type="date" value={form.date} onChange={update('date')} required /></label><label>Einsatzort<select value={form.objectId} onChange={update('objectId')}><option value="">Ohne gespeicherten Einsatzort</option>{objects.map((object) => <option value={object.id} key={object.id}>{object.name}</option>)}</select></label></div><div className="form-grid three"><label>Beginn<input type="time" value={form.start} onChange={update('start')} required /></label><label>Ende<input type="time" value={form.end} onChange={update('end')} required /></label><label>Pause in Minuten<input type="number" min="0" step="1" value={form.pauseMinutes} onChange={update('pauseMinutes')} required /></label></div><div className="form-grid"><label>Bezeichnung des Einsatzortes<input value={form.location} onChange={update('location')} required={!form.objectId} /></label><label>Arbeitsbereich<input value={form.workArea} onChange={update('workArea')} required /></label></div><label>Bemerkung<textarea rows="3" value={form.note || ''} onChange={update('note')} /></label><fieldset className="repeat-field"><legend>Zusätzlich auf andere Tage dieser Woche übernehmen</legend>{days.filter((date) => date !== form.date).map((date) => <label key={date}><input type="checkbox" checked={form.repeatDays?.includes(date) || false} onChange={(event) => setForm((current) => ({ ...current, repeatDays: event.target.checked ? [...(current.repeatDays || []), date] : (current.repeatDays || []).filter((item) => item !== date) }))} /><span>{formatDate(date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</span></label>)}</fieldset><div className="form-actions"><button className="primary-button" disabled={Boolean(busy)}>{busy === 'save' ? 'Wird gespeichert …' : 'Als Entwurf speichern'}</button>{form.id && <button type="button" className="danger-outline" disabled={Boolean(busy)} onClick={remove}>Dienst löschen</button>}<button type="button" className="secondary-button" onClick={() => { setForm({ ...emptyForm }); setEditing(false) }}>Abbrechen</button></div></form></section>}
  </>
}

function buildSessions(entries, fallbackName) {
  const ordered = [...entries].sort((a, b) => String(a.clientOccurredAt).localeCompare(String(b.clientOccurredAt)))
  const sessions = []
  let current = null
  for (const event of ordered) {
    if (event.action === 'clock-in') current = { date: event.eventDate, employeeName: event.employeeName || fallbackName, clockInAt: event.clientOccurredAt, clockOutAt: null, breakMinutes: 0, breakStart: null, location: event.workSiteName || event.objectId || '–', status: event.locationStatus }
    else if (event.action === 'break-start' && current) current.breakStart = event.clientOccurredAt
    else if (event.action === 'break-end' && current?.breakStart) { current.breakMinutes += Math.max(0, Math.round((new Date(event.clientOccurredAt) - new Date(current.breakStart)) / 60000)); current.breakStart = null }
    else if (event.action === 'clock-out' && current) { current.clockOutAt = event.clientOccurredAt; const gross = Math.max(0, Math.round((new Date(current.clockOutAt) - new Date(current.clockInAt)) / 60000)); current.netMinutes = Math.max(0, gross - current.breakMinutes); sessions.push(current); current = null }
  }
  if (current) sessions.push({ ...current, netMinutes: 0 })
  return sessions
}

function TimesPage({ session }) {
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = `${today.slice(0, 7)}-01`
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [entries, setEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [userId, setUserId] = useState('')
  const [notice, setNotice] = useState(null)

  const loadEmployees = useCallback(async () => {
    if (!MANAGEMENT.has(session.role)) return
    try { const data = await apiJson('/api/registrations'); setEmployees(data.employees || []) } catch {}
  }, [session.role])
  useEffect(() => { loadEmployees() }, [loadEmployees])

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ resource: 'history', from, to })
      if (MANAGEMENT.has(session.role) && userId) params.set('userId', userId)
      const data = await apiJson(`/api/attendance?${params}`)
      setEntries(data.entries || [])
      setNotice(null)
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [from, to, session.role, userId])
  useEffect(() => { load() }, [load])

  const selectedName = employees.find((employee) => (employee.userId || employee.id) === userId)?.fullName || session.fullName
  const sessions = useMemo(() => buildSessions(entries, selectedName), [entries, selectedName])
  const total = sessions.reduce((sum, item) => sum + (item.netMinutes || 0), 0)
  return <>
    <section className="panel filter-panel"><div className="filter-grid"><label>Von<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Bis<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>{MANAGEMENT.has(session.role) && <label>Mitarbeiter<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Alle berechtigten Daten</option>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select></label>}<button className="primary-button" onClick={load}>Zeitraum anzeigen</button></div></section>
    <Notice notice={notice} />
    <section className="metric-strip compact-metrics"><div><span>Zeitraum</span><strong>{formatDate(from, { day: '2-digit', month: '2-digit' })}–{formatDate(to, { day: '2-digit', month: '2-digit' })}</strong></div><div><span>Dienste</span><strong>{sessions.length}</strong></div><div><span>Pausen</span><strong>{formatDuration(sessions.reduce((sum, item) => sum + item.breakMinutes, 0))}</strong></div><div><span>Gesamt</span><strong>{formatDuration(total)}</strong></div></section>
    <section className="panel"><PageHeader title="Meine Zeiten" subtitle={MANAGEMENT.has(session.role) ? 'Arbeitszeiten im ausgewählten Berechtigungsbereich.' : 'Nur deine eigenen Buchungen und Stunden.'} />{sessions.length ? <div className="times-list">{sessions.map((item, index) => <article key={`${item.clockInAt}-${index}`}><header><strong>{formatDate(item.date, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</strong><Status tone={item.clockOutAt ? 'success' : 'warning'}>{item.clockOutAt ? 'Abgeschlossen' : 'Offen'}</Status></header><div className="time-values"><div><span>Beginn</span><strong>{formatDate(item.clockInAt, { hour: '2-digit', minute: '2-digit' })}</strong></div><div><span>Pause</span><strong>{item.breakMinutes} Min.</strong></div><div><span>Ende</span><strong>{item.clockOutAt ? formatDate(item.clockOutAt, { hour: '2-digit', minute: '2-digit' }) : '–'}</strong></div><div><span>Netto</span><strong>{formatDuration(item.netMinutes)}</strong></div></div><p>{item.location}</p></article>)}</div> : <Empty>In diesem Zeitraum wurden keine Zeiten gefunden.</Empty>}</section>
  </>
}

function WorksitesPage() {
  const [objects, setObjects] = useState([])
  const [form, setForm] = useState({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const load = useCallback(async () => { try { const data = await apiJson('/api/schedule-v2?resource=objects'); setObjects(data.objects || []) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])
  useEffect(() => { load() }, [load])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  async function save(event) {
    event.preventDefault(); setBusy(true)
    try { await apiJson('/api/schedule-v2', { method: 'POST', body: JSON.stringify({ action: 'object-upsert', ...form }) }); setNotice({ tone: 'success', text: 'Einsatzort wurde gespeichert.' }); setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 }); await load() }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy(false) }
  }
  return <><Notice notice={notice} /><section className="panel"><PageHeader title={form.id ? 'Einsatzort bearbeiten' : 'Einsatzort anlegen'} subtitle="Koordinaten werden nur zur Prüfung beim Ein- und Ausstempeln verwendet." /><form className="worksite-form" onSubmit={save}><div className="form-grid"><label>Name<input value={form.name} onChange={update('name')} required /></label><label>Adresse<input value={form.address} onChange={update('address')} required /></label></div><div className="form-grid three"><label>Breitengrad<input inputMode="decimal" value={form.latitude} onChange={update('latitude')} /></label><label>Längengrad<input inputMode="decimal" value={form.longitude} onChange={update('longitude')} /></label><label>Prüfradius in Metern<input type="number" min="0" max="10000" value={form.radiusMeters} onChange={update('radiusMeters')} /></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Einsatzort speichern'}</button>{form.id && <button type="button" className="secondary-button" onClick={() => setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })}>Abbrechen</button>}</div></form></section><section className="panel"><PageHeader title="Gespeicherte Einsatzorte" subtitle="Name, Adresse und Standortprüfung." />{objects.length ? <div className="card-list">{objects.map((object) => <button className="worksite-card" key={object.id} onClick={() => setForm({ id: object.id, name: object.name, address: object.address, latitude: object.latitude ?? '', longitude: object.longitude ?? '', radiusMeters: object.radiusMeters ?? 500 })}><div><strong>{object.name}</strong><span>{object.address}</span></div><div><strong>{object.radiusMeters || 500} m</strong><span>Prüfradius</span></div></button>)}</div> : <Empty>Noch keine Einsatzorte gespeichert.</Empty>}</section></>
}

function CorrectionsPage({ session }) {
  const [corrections, setCorrections] = useState([])
  const [events, setEvents] = useState([])
  const [form, setForm] = useState({ eventId: '', clockInAt: '', clockOutAt: '', pauseMinutes: '', note: '', reason: '' })
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const management = MANAGEMENT.has(session.role)
  const load = useCallback(async () => {
    try {
      const [correctionData, eventData] = await Promise.all([apiJson('/api/attendance-maintenance?resource=corrections'), apiJson('/api/attendance?resource=state')])
      setCorrections(correctionData.corrections || [])
      setEvents(eventData.events || [])
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }, [])
  useEffect(() => { load() }, [load])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  async function submit(event) {
    event.preventDefault(); setBusy(true)
    try {
      const requestedData = {}
      if (form.clockInAt) requestedData.clockInAt = new Date(form.clockInAt).toISOString()
      if (form.clockOutAt) requestedData.clockOutAt = new Date(form.clockOutAt).toISOString()
      if (form.pauseMinutes !== '') requestedData.pauseMinutes = Number(form.pauseMinutes)
      if (form.note) requestedData.note = form.note
      await apiJson('/api/attendance-maintenance', { method: 'POST', body: JSON.stringify({ action: 'request-correction', eventId: form.eventId, reason: form.reason, requestedData }) })
      setNotice({ tone: 'success', text: 'Korrekturantrag wurde gesendet.' }); setForm({ eventId: '', clockInAt: '', clockOutAt: '', pauseMinutes: '', note: '', reason: '' }); await load()
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy(false) }
  }
  async function decide(correctionId, decision) {
    const reason = window.prompt('Begründung der Entscheidung')
    if (!reason) return
    try { await apiJson('/api/attendance-maintenance', { method: 'POST', body: JSON.stringify({ action: 'decide-correction', correctionId, decision, reason }) }); setNotice({ tone: 'success', text: 'Entscheidung wurde gespeichert.' }); await load() }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
  }
  return <><Notice notice={notice} /><section className="panel"><PageHeader title="Korrektur beantragen" subtitle="Die ursprüngliche Buchung bleibt unverändert und nachvollziehbar." /><form className="correction-form" onSubmit={submit}><label>Buchung<select value={form.eventId} onChange={update('eventId')} required><option value="">Bitte wählen</option>{events.map((event) => <option key={event.id} value={event.id}>{actionLabel(event.action)} · {formatDateTime(event.clientOccurredAt)}</option>)}</select></label><div className="form-grid three"><label>Gewünschter Beginn<input type="datetime-local" value={form.clockInAt} onChange={update('clockInAt')} /></label><label>Gewünschtes Ende<input type="datetime-local" value={form.clockOutAt} onChange={update('clockOutAt')} /></label><label>Gewünschte Pause<input type="number" min="0" value={form.pauseMinutes} onChange={update('pauseMinutes')} /></label></div><label>Bemerkung<textarea rows="2" value={form.note} onChange={update('note')} /></label><label>Begründung<textarea rows="3" value={form.reason} onChange={update('reason')} required /></label><button className="primary-button" disabled={busy}>Korrekturantrag senden</button></form></section><section className="panel"><PageHeader title="Anträge" subtitle={management ? 'Anträge prüfen, genehmigen oder ablehnen.' : 'Status deiner eigenen Anträge.'} />{corrections.length ? <div className="card-list">{corrections.map((item) => <article className="correction-card" key={item.id}><div><strong>{formatDateTime(item.occurred_at)}</strong><span>{item.reason}</span><small>{item.decision_reason || 'Noch keine Entscheidungsbegründung'}</small></div><Status tone={item.decision === 'approved' ? 'success' : item.decision === 'rejected' ? 'danger' : 'warning'}>{item.decision === 'approved' ? 'Genehmigt' : item.decision === 'rejected' ? 'Abgelehnt' : item.decision === 'clarification' ? 'Rückfrage' : 'Offen'}</Status>{management && !item.decision && <div className="row-actions"><button className="primary-button compact" onClick={() => decide(item.id, 'approved')}>Genehmigen</button><button className="danger-outline compact" onClick={() => decide(item.id, 'rejected')}>Ablehnen</button><button className="secondary-button compact" onClick={() => decide(item.id, 'clarification')}>Rückfrage</button></div>}</article>)}</div> : <Empty>Keine Korrekturanträge vorhanden.</Empty>}</section></>
}

function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState([])
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  useEffect(() => { apiJson('/api/registrations').then((data) => setEmployees(data.employees || [])).catch((error) => setNotice({ tone: 'error', text: error.message })) }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const payload = { from, to, userIds: selected, reportType: selected.length === 1 ? 'employee' : 'combined' }
  async function generate(format, previewOnly = false) {
    setBusy(format); setNotice(null)
    try {
      const { blob, filename } = await apiBlob('/api/unified-reports', { method: 'POST', body: JSON.stringify({ ...payload, format }) })
      if (previewOnly) { if (preview) URL.revokeObjectURL(preview); setPreview(URL.createObjectURL(blob)) }
      else downloadBlob(blob, filename)
    } catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy('') }
  }
  return <><section className="panel filter-panel"><PageHeader title="Bericht auswählen" subtitle="PDF und Excel verwenden dieselben Arbeitszeitdaten." /><div className="filter-grid reports-filter"><label>Von<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Bis<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Mitarbeiter<select multiple value={selected} onChange={(event) => setSelected([...event.target.selectedOptions].map((option) => option.value))}>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select><small>Keine Auswahl bedeutet Gesamtübersicht.</small></label></div><div className="form-actions"><button className="secondary-button" disabled={Boolean(busy)} onClick={() => generate('pdf', true)}>{busy === 'pdf' ? 'PDF wird erstellt …' : 'PDF-Vorschau'}</button><button className="primary-button" disabled={Boolean(busy)} onClick={() => generate('pdf')}>PDF herunterladen</button><button className="secondary-button" disabled={Boolean(busy)} onClick={() => generate('xlsx')}>{busy === 'xlsx' ? 'Excel wird erstellt …' : 'Excel herunterladen'}</button></div></section><Notice notice={notice} />{preview && <section className="panel"><PageHeader title="PDF-Vorschau" subtitle="Das Dokument enthält Logo, Firmenname, Telefonnummer und E-Mail-Adresse." /><iframe className="pdf-preview" title="PDF-Vorschau" src={preview} /></section>}</>
}

function SettingsPage() {
  const [form, setForm] = useState({ companyName: 'Habun Security', phone: '', email: '', logoUrl: '/habun-logo.png' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const load = useCallback(async () => { try { const data = await apiJson('/api/company-settings'); setForm(data.settings || form) } catch (error) { setNotice({ tone: 'error', text: error.message }) } }, [])
  useEffect(() => { load() }, [load])
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  async function save(event) {
    event.preventDefault(); setBusy(true)
    try { const data = await apiJson('/api/company-settings', { method: 'PUT', body: JSON.stringify(form) }); setForm(data.settings); setNotice({ tone: 'success', text: 'Firmendaten wurden gespeichert und werden automatisch in neuen PDFs verwendet.' }) }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setBusy(false) }
  }
  return <><Notice notice={notice} /><section className="settings-layout"><section className="panel"><PageHeader title="Firmendaten" subtitle="Einmal speichern – automatisch in jedem neuen Bericht verwenden." /><form className="settings-form" onSubmit={save}><label>Firmenname<input value={form.companyName || ''} onChange={update('companyName')} required /></label><label>Telefonnummer<input type="tel" value={form.phone || ''} onChange={update('phone')} required /></label><label>E-Mail-Adresse<input type="email" value={form.email || ''} onChange={update('email')} required /></label><label>Logo-Pfad<input value={form.logoUrl || '/habun-logo.png'} onChange={update('logoUrl')} required /><small>Das bestehende Habun-Logo bleibt unverändert.</small></label><button className="primary-button" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Einstellungen speichern'}</button></form></section><aside className="panel settings-preview"><PageHeader title="PDF-Kopf" subtitle="Vorschau der gespeicherten Firmendaten." /><div className="letterhead-preview"><img src={form.logoUrl || '/habun-logo.png'} alt="Firmenlogo" /><div><strong>{form.companyName || 'Habun Security'}</strong><span>{form.phone || 'Telefonnummer'}</span><span>{form.email || 'E-Mail-Adresse'}</span></div></div><p>Diese Angaben werden bei PDF- und Excel-Berichten automatisch eingesetzt.</p></aside></section></>
}

function UnifiedPortal({ session, onLogout }) {
  const allowed = NAVIGATION.filter((item) => item.roles.includes(session.role)).map((item) => item.key)
  const initialPage = session.role === 'employee' ? 'attendance' : 'overview'
  const [page, setPage] = useState(initialPage)
  useEffect(() => { if (!allowed.includes(page)) setPage(initialPage) }, [allowed, initialPage, page])
  const content = page === 'overview' ? <OverviewPage session={session} navigate={setPage} />
    : page === 'attendance' ? <AttendancePage session={session} />
      : page === 'employees' ? <EmployeesPage session={session} />
        : page === 'schedule' ? <SchedulePage session={session} />
          : page === 'times' ? <TimesPage session={session} />
            : page === 'worksites' ? <WorksitesPage />
              : page === 'corrections' ? <CorrectionsPage session={session} />
                : page === 'reports' ? <ReportsPage />
                  : page === 'settings' ? <SettingsPage />
                    : <OverviewPage session={session} navigate={setPage} />
  return <PortalShell session={session} page={page} setPage={setPage} onLogout={onLogout}>{content}</PortalShell>
}

export default function App() {
  const [identityUser, setIdentityUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)

  const loadSession = useCallback(async (user) => {
    if (!user) { setSession(null); setLoading(false); return }
    try { setSession(await apiJson('/api/session')) }
    catch (error) { setNotice({ tone: 'error', text: error.message }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let unsubscribe = () => {}
    ;(async () => {
      try {
        const callback = await handleAuthCallback()
        if (callback?.type === 'confirmation') setNotice({ tone: 'success', text: 'E-Mail erfolgreich bestätigt.' })
        const user = await getUser()
        setIdentityUser(user)
        await loadSession(user)
        unsubscribe = onAuthChange(async (_event, currentUser) => { setIdentityUser(currentUser); await loadSession(currentUser) })
      } catch (error) { setNotice({ tone: 'error', text: error.message }); setLoading(false) }
    })()
    return () => unsubscribe()
  }, [loadSession])

  async function signOut() { await logout(); setIdentityUser(null); setSession(null) }
  if (loading) return <div className="loading-screen"><Brand /><span>Portal wird sicher geladen …</span></div>
  if (!identityUser || !session) return <AuthScreen notice={notice} setNotice={setNotice} />
  if (session.role === 'pending') return <PendingScreen session={session} onLogout={signOut} />
  return <UnifiedPortal session={session} onLogout={signOut} />
}
