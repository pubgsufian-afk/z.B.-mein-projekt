import { useCallback, useEffect, useMemo, useState } from 'react'
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
import './styles.css'

const ROLE_LABELS = {
  owner: 'Chef / Hauptadmin',
  admin: 'Admin',
  manager: 'Einsatzleiter',
  employee: 'Mitarbeiter',
  pending: 'Wartet auf Freigabe',
}

const NAV_ITEMS = [
  ['overview', 'Übersicht'],
  ['employees', 'Mitarbeiter'],
  ['schedule', 'Dienstplan'],
  ['times', 'Stundenzettel'],
  ['objects', 'Objekte'],
  ['reports', 'Berichte'],
  ['settings', 'Einstellungen'],
]

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'Die Anfrage konnte nicht verarbeitet werden.')
  return body
}

function Brand({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <img src="/habun-logo.png" alt="Habun Security" />
      {compact ? null : (
        <div>
          <strong>Habun Security</strong>
          <span>Mitarbeiterportal</span>
        </div>
      )}
    </div>
  )
}

function Status({ tone = 'neutral', children }) {
  return <span className={`status status-${tone}`}>{children}</span>
}

function AuthScreen({ notice, setNotice }) {
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    employeeId: '',
    phone: '',
    company: 'Habun Security',
    location: '',
    password: '',
  })

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
          employee_id: form.employeeId.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          location: form.location.trim(),
          requested_role: 'employee',
        })
        setNotice({
          tone: 'success',
          text: 'Registrierungsanfrage gesendet. Bitte bestätige zuerst deine E-Mail. Danach wartet das Konto auf die Freigabe durch die Firma.',
        })
        setMode('login')
      }
    } catch (error) {
      const message = error instanceof AuthError ? error.message : 'Anmeldung nicht möglich.'
      setNotice({ tone: 'error', text: message })
    } finally {
      setBusy(false)
    }
  }

  async function recover() {
    if (!form.email) {
      setNotice({ tone: 'error', text: 'Bitte zuerst die E-Mail-Adresse eintragen.' })
      return
    }
    setBusy(true)
    try {
      await requestPasswordRecovery(form.email.trim().toLowerCase())
      setNotice({ tone: 'success', text: 'Eine E-Mail zum Zurücksetzen des Passworts wurde versendet.' })
    } catch {
      setNotice({ tone: 'error', text: 'Die Wiederherstellungs-E-Mail konnte nicht versendet werden.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Brand />
        <div className="auth-copy">
          <h1>Arbeitszeiten und Dienstpläne sicher verwalten.</h1>
          <p>
            Dieses Portal ist ausschließlich für freigeschaltete Mitarbeiter von Habun Security bestimmt.
          </p>
          <ul>
            <li>Konten werden erst nach Prüfung aktiviert</li>
            <li>Adminrechte werden niemals öffentlich vergeben</li>
            <li>Jeder Mitarbeiter sieht nur seine eigenen Daten</li>
          </ul>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <Brand compact />
          <h2>{mode === 'login' ? 'Anmelden' : 'Registrierung anfragen'}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'Mit deinem freigeschalteten Firmenkonto anmelden.'
              : 'Nach der E-Mail-Bestätigung prüft ein Admin deine Anfrage.'}
          </p>

          <div className="auth-tabs" role="tablist" aria-label="Anmeldung oder Registrierung">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Anmeldung
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              Registrierung
            </button>
          </div>

          <form onSubmit={submit} className="form-stack">
            {mode === 'register' ? (
              <>
                <label>
                  Vollständiger Name
                  <input value={form.fullName} onChange={update('fullName')} required autoComplete="name" />
                </label>
                <label>
                  Mitarbeiter-ID
                  <input value={form.employeeId} onChange={update('employeeId')} required />
                </label>
              </>
            ) : null}
            <label>
              E-Mail-Adresse
              <input type="email" value={form.email} onChange={update('email')} required autoComplete="email" />
            </label>
            <label>
              Passwort
              <input
                type="password"
                minLength={10}
                value={form.password}
                onChange={update('password')}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
            {mode === 'register' ? (
              <>
                <div className="form-grid">
                  <label>
                    Firma
                    <input value={form.company} onChange={update('company')} required />
                  </label>
                  <label>
                    Objekt / Einsatzort
                    <input value={form.location} onChange={update('location')} required />
                  </label>
                </div>
                <label>
                  Telefonnummer <span className="optional">optional</span>
                  <input type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" />
                </label>
              </>
            ) : null}

            {notice ? <div className={`notice notice-${notice.tone}`}>{notice.text}</div> : null}

            <button className="primary-button" disabled={busy}>
              {busy ? 'Bitte warten …' : mode === 'login' ? 'Sicher anmelden' : 'Anfrage absenden'}
            </button>
          </form>

          {mode === 'login' ? (
            <button className="text-button" type="button" onClick={recover} disabled={busy}>
              Passwort vergessen
            </button>
          ) : null}

          <p className="security-note">Kein öffentlicher Admin-Zugang. Freigaben erfolgen ausschließlich intern.</p>
        </div>
      </section>
    </main>
  )
}

function PendingScreen({ profile, onLogout }) {
  return (
    <main className="pending-page">
      <div className="pending-card">
        <Brand />
        <div className="pending-mark" aria-hidden="true">✓</div>
        <h1>Registrierung eingegangen</h1>
        <p>
          Hallo {profile.fullName || 'Mitarbeiter'}, deine E-Mail wurde bestätigt. Dein Konto wartet jetzt auf die
          Freigabe durch Habun Security.
        </p>
        <div className="pending-details">
          <div><span>Status</span><strong>Prüfung durch Admin</strong></div>
          <div><span>Mitarbeiter-ID</span><strong>{profile.employeeId || '—'}</strong></div>
          <div><span>Einsatzort</span><strong>{profile.location || '—'}</strong></div>
        </div>
        <p className="muted">Du kannst dich anmelden, sobald ein berechtigter Admin deine Anfrage freigeschaltet hat.</p>
        <button className="secondary-button" onClick={onLogout}>Abmelden</button>
      </div>
    </main>
  )
}

function Sidebar({ page, setPage, role, onLogout }) {
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Hauptnavigation">
        {NAV_ITEMS.map(([key, label]) => (
          <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>
            <span className="nav-dot" aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <Status tone="gold">{ROLE_LABELS[role] || role}</Status>
        <button className="text-button light" onClick={onLogout}>Abmelden</button>
      </div>
    </aside>
  )
}

function RegistrationTable({ requests, reload }) {
  const [busyId, setBusyId] = useState('')

  async function decide(id, action, role = 'employee') {
    setBusyId(id)
    try {
      await api('/api/registrations', {
        method: 'PATCH',
        body: JSON.stringify({ id, action, role }),
      })
      await reload()
    } finally {
      setBusyId('')
    }
  }

  if (!requests.length) {
    return <div className="empty-state">Keine offenen Registrierungsanfragen.</div>
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Mitarbeiter-ID</th><th>Einsatzort</th><th>Prüfcode</th><th>Status</th><th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td><strong>{request.fullName}</strong><small>{request.email}</small></td>
              <td>{request.employeeId}</td>
              <td>{request.location}</td>
              <td><code>{request.approvalCode}</code></td>
              <td><Status tone="warning">Ausstehend</Status></td>
              <td>
                <div className="table-actions">
                  <button disabled={busyId === request.id} onClick={() => decide(request.id, 'approve')}>
                    Freischalten
                  </button>
                  <button className="danger-link" disabled={busyId === request.id} onClick={() => decide(request.id, 'reject')}>
                    Ablehnen
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScheduleTable({ shifts }) {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  return (
    <div className="table-scroll">
      <table className="schedule-table">
        <thead><tr><th>Mitarbeiter</th>{days.map((day) => <th key={day}>{day}</th>)}</tr></thead>
        <tbody>
          {(shifts.length ? shifts : [{ employeeName: 'Noch kein Dienst', days: {} }]).map((row, index) => (
            <tr key={`${row.employeeId || 'empty'}-${index}`}>
              <td><strong>{row.employeeName}</strong></td>
              {days.map((day) => (
                <td key={day}>
                  {row.days?.[day] ? (
                    <><strong>{row.days[day].start}–{row.days[day].end}</strong><small>{row.days[day].location}</small></>
                  ) : <span className="muted">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminDashboard({ session, onLogout }) {
  const [page, setPage] = useState('overview')
  const [requests, setRequests] = useState([])
  const [shifts, setShifts] = useState([])
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const [registrationData, workData] = await Promise.all([
        api('/api/registrations'),
        api('/api/work?resource=schedule'),
      ])
      setRequests(registrationData.requests || [])
      setShifts(workData.shifts || [])
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={setPage} role={session.role} onLogout={onLogout} />
      <main className="app-main">
        <header className="topbar">
          <div>
            <h1>{NAV_ITEMS.find(([key]) => key === page)?.[1] || 'Mitarbeiterportal'}</h1>
            <p>Habun Security · Geschützter Firmenbereich</p>
          </div>
          <div className="account-chip">
            <span>{session.fullName?.slice(0, 1) || 'A'}</span>
            <div><strong>{session.fullName}</strong><small>{ROLE_LABELS[session.role]}</small></div>
          </div>
        </header>

        {error ? <div className="notice notice-error">{error}</div> : null}

        <section className="metric-strip">
          <div><span>Offene Anfragen</span><strong>{requests.length}</strong></div>
          <div><span>Freigeschaltete Mitarbeiter</span><strong>{session.employeeCount || 0}</strong></div>
          <div><span>Dienste diese Woche</span><strong>{shifts.length}</strong></div>
          <div><span>Systemstatus</span><strong className="online">Geschützt</strong></div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><h2>Neue Registrierungsanfragen</h2><p>Nur bestätigte Anfragen erhalten Zugriff.</p></div>
            <button className="secondary-button compact" onClick={reload}>Aktualisieren</button>
          </div>
          <RegistrationTable requests={requests} reload={reload} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div><h2>Dienstplan – aktuelle Woche</h2><p>Mitarbeiter, Arbeitszeiten und Einsatzorte.</p></div>
            <button className="primary-button compact" onClick={() => setPage('schedule')}>Dienst erstellen</button>
          </div>
          <ScheduleTable shifts={shifts} />
        </section>
      </main>
    </div>
  )
}

function EmployeeDashboard({ session, onLogout }) {
  const [tab, setTab] = useState('start')
  const [workState, setWorkState] = useState('idle')
  const [notice, setNotice] = useState('')

  async function record(action) {
    try {
      await api('/api/work', { method: 'POST', body: JSON.stringify({ resource: 'time', action }) })
      setWorkState(action)
      setNotice('Zeit wurde sicher gespeichert.')
    } catch (error) {
      setNotice(error.message)
    }
  }

  return (
    <div className="employee-app">
      <header className="employee-header">
        <Brand />
        <button className="text-button light" onClick={onLogout}>Abmelden</button>
      </header>
      <main>
        <p className="date-line">Heute · persönlicher Bereich</p>
        <h1>Hallo, {session.fullName}</h1>
        <section className="shift-card">
          <div className="shift-card-head"><span>Aktueller Dienst</span><Status tone="gold">Geplant</Status></div>
          <strong className="shift-time">{session.todayShift?.start || '—'} – {session.todayShift?.end || '—'}</strong>
          <p>{session.todayShift?.location || 'Noch kein Dienst eingetragen'}</p>
          <button className="primary-button" onClick={() => record('started')} disabled={workState === 'started'}>
            {workState === 'started' ? 'Arbeitsbeginn gespeichert' : 'Arbeitsbeginn starten'}
          </button>
          <div className="pause-actions">
            <button className="secondary-button" onClick={() => record('break-started')}>Pause starten</button>
            <button className="secondary-button" onClick={() => record('break-ended')}>Pause beenden</button>
          </div>
          <button className="danger-outline" onClick={() => record('ended')}>Arbeitsende eintragen</button>
          {notice ? <p className="inline-notice">{notice}</p> : null}
        </section>
        <section className="panel employee-panel">
          <div className="panel-heading"><div><h2>Mein Dienstplan</h2><p>Nur deine eigenen geplanten Dienste.</p></div></div>
          <div className="empty-state">Noch keine Dienste für diese Woche eingetragen.</div>
        </section>
      </main>
      <nav className="mobile-nav" aria-label="Mitarbeiternavigation">
        {['start', 'schedule', 'times', 'profile'].map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item === 'start' ? 'Start' : item === 'schedule' ? 'Dienstplan' : item === 'times' ? 'Zeiten' : 'Profil'}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  const [identityUser, setIdentityUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)

  const loadSession = useCallback(async (user) => {
    if (!user) {
      setSession(null)
      setLoading(false)
      return
    }
    try {
      setSession(await api('/api/session'))
    } catch (error) {
      setNotice({ tone: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let unsubscribe = () => {}
    ;(async () => {
      try {
        const callback = await handleAuthCallback()
        if (callback?.type === 'confirmation') {
          setNotice({ tone: 'success', text: 'E-Mail erfolgreich bestätigt.' })
        }
        const user = await getUser()
        setIdentityUser(user)
        await loadSession(user)
        unsubscribe = onAuthChange(async (_event, currentUser) => {
          setIdentityUser(currentUser)
          await loadSession(currentUser)
        })
      } catch (error) {
        setNotice({ tone: 'error', text: error.message })
        setLoading(false)
      }
    })()
    return () => unsubscribe()
  }, [loadSession])

  async function signOut() {
    await logout()
    setIdentityUser(null)
    setSession(null)
  }

  const isAdmin = useMemo(() => ['owner', 'admin', 'manager'].includes(session?.role), [session?.role])

  if (loading) return <div className="loading-screen"><Brand /><span>Portal wird sicher geladen …</span></div>
  if (!identityUser || !session) return <AuthScreen notice={notice} setNotice={setNotice} />
  if (session.role === 'pending') return <PendingScreen profile={session} onLogout={signOut} />
  if (isAdmin) return <AdminDashboard session={session} onLogout={signOut} />
  return <EmployeeDashboard session={session} onLogout={signOut} />
}
