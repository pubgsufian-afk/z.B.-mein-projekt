import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

function api(token) {
  return axios.create({
    baseURL: API_BASE,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
}

function toHours(entry) {
  const [sh, sm] = entry.start_time.split(':').map(Number)
  const [eh, em] = entry.end_time.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm) - Number(entry.break_minutes || 0)
  return Math.max(0, mins / 60).toFixed(2)
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [user, setUser] = useState(null)
  const [error, setError] = useState('')
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [allEntries, setAllEntries] = useState([])
  const [users, setUsers] = useState([])

  const [authForm, setAuthForm] = useState({ full_name: '', email: '', password: '' })
  const [entryForm, setEntryForm] = useState({
    work_date: new Date().toISOString().slice(0, 10),
    start_time: '09:00',
    end_time: '17:00',
    break_minutes: 30,
    note: ''
  })

  useEffect(() => {
    if (!token) return
    localStorage.setItem('token', token)
    loadMe(token)
  }, [token])

  async function loadMe(currentToken = token) {
    try {
      const me = await api(currentToken).get('/me')
      setUser(me.data)
      await loadMonthly(currentToken)
      if (me.data.is_admin) {
        await loadAdmin(currentToken)
      }
    } catch {
      setError('Session ungültig. Bitte neu einloggen.')
      logout()
    }
  }

  async function loadMonthly(currentToken = token) {
    const res = await api(currentToken).get('/entries/monthly', { params: { month, year } })
    setEntries(res.data.entries)
    setTotal(res.data.total_hours)
  }

  async function loadAdmin(currentToken = token) {
    const [entryRes, userRes] = await Promise.all([
      api(currentToken).get('/admin/entries'),
      api(currentToken).get('/admin/users')
    ])
    setAllEntries(entryRes.data)
    setUsers(userRes.data)
  }

  async function login() {
    setError('')
    try {
      const res = await api().post('/auth/login', {
        email: authForm.email,
        password: authForm.password
      })
      setToken(res.data.access_token)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Login fehlgeschlagen')
    }
  }

  async function register(isAdmin = false) {
    setError('')
    try {
      await api().post('/auth/register', { ...authForm, is_admin: isAdmin })
      await login()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Registrierung fehlgeschlagen')
    }
  }

  async function createEntry() {
    setError('')
    try {
      await api(token).post('/entries', {
        ...entryForm,
        break_minutes: Number(entryForm.break_minutes)
      })
      await loadMonthly()
      if (user?.is_admin) await loadAdmin()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Eintrag konnte nicht gespeichert werden')
    }
  }

  async function toggleApproval(entry) {
    await api(token).put(`/admin/entries/${entry.id}`, {
      work_date: entry.work_date,
      start_time: entry.start_time,
      end_time: entry.end_time,
      break_minutes: entry.break_minutes,
      note: entry.note,
      approved: !entry.approved
    })
    await loadAdmin()
  }

  function logout() {
    localStorage.removeItem('token')
    setToken('')
    setUser(null)
    setEntries([])
    setTotal(0)
  }

  const userCount = useMemo(() => users.length, [users])

  if (!token || !user) {
    return (
      <div className="container auth">
        <div className="card">
          <h1>Zeiterfassung</h1>
          <p>Login pro Mitarbeiter + Admin-Funktionen.</p>
          <input placeholder="Name" value={authForm.full_name} onChange={(e) => setAuthForm({ ...authForm, full_name: e.target.value })} />
          <input placeholder="E-Mail" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
          <input type="password" placeholder="Passwort" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
          <div className="row">
            <button onClick={login}>Login</button>
            <button className="secondary" onClick={() => register(false)}>Mitarbeiter registrieren</button>
            <button className="secondary" onClick={() => register(true)}>Admin registrieren</button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <header className="header card">
        <div>
          <h2>Willkommen, {user.full_name}</h2>
          <p>{user.is_admin ? 'Admin' : 'Mitarbeiter'} · {user.email}</p>
        </div>
        <button onClick={logout}>Logout</button>
      </header>

      <section className="card">
        <h3>Arbeitszeit eintragen</h3>
        <div className="grid">
          <input type="date" value={entryForm.work_date} onChange={(e) => setEntryForm({ ...entryForm, work_date: e.target.value })} />
          <input type="time" value={entryForm.start_time} onChange={(e) => setEntryForm({ ...entryForm, start_time: e.target.value })} />
          <input type="time" value={entryForm.end_time} onChange={(e) => setEntryForm({ ...entryForm, end_time: e.target.value })} />
          <input type="number" min="0" value={entryForm.break_minutes} onChange={(e) => setEntryForm({ ...entryForm, break_minutes: e.target.value })} placeholder="Pause in Min" />
          <input value={entryForm.note} onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })} placeholder="Notiz" />
          <button onClick={createEntry}>Speichern</button>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h3>Monatsübersicht</h3>
          <div className="row">
            <input type="number" value={month} min="1" max="12" onChange={(e) => setMonth(Number(e.target.value))} />
            <input type="number" value={year} min="2020" max="2100" onChange={(e) => setYear(Number(e.target.value))} />
            <button onClick={() => loadMonthly()}>Laden</button>
          </div>
        </div>
        <p className="badge">Monatsstunden gesamt: {total} h</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Datum</th><th>Start</th><th>Ende</th><th>Pause</th><th>Notiz</th><th>Std.</th><th>Status</th></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.work_date}</td><td>{entry.start_time.slice(0, 5)}</td><td>{entry.end_time.slice(0, 5)}</td><td>{entry.break_minutes}m</td><td>{entry.note}</td><td>{toHours(entry)}</td><td>{entry.approved ? 'Freigegeben' : 'Offen'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {user.is_admin && (
        <section className="card">
          <div className="row between">
            <h3>Admin-Bereich</h3>
            <div className="row">
              <a href={`${API_BASE}/admin/export/csv`} target="_blank" rel="noreferrer"><button>CSV Export</button></a>
              <a href={`${API_BASE}/admin/export/pdf`} target="_blank" rel="noreferrer"><button>PDF Export</button></a>
            </div>
          </div>
          <p className="badge">Mitarbeiter gesamt: {userCount}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Mitarbeiter-ID</th><th>Datum</th><th>Zeit</th><th>Pause</th><th>Notiz</th><th>Std.</th><th>Freigabe</th></tr></thead>
              <tbody>
                {allEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.id}</td><td>{entry.user_id}</td><td>{entry.work_date}</td><td>{entry.start_time.slice(0, 5)}-{entry.end_time.slice(0, 5)}</td><td>{entry.break_minutes}m</td><td>{entry.note}</td><td>{toHours(entry)}</td>
                    <td><button className={entry.approved ? 'ok' : 'secondary'} onClick={() => toggleApproval(entry)}>{entry.approved ? 'Freigegeben' : 'Freigeben'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
