import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

async function replaceInFile(path, before, after, label) {
  let source = await readFile(path, 'utf8')
  if (source.includes(after)) return false
  assert.ok(source.includes(before), `${label} wurde in ${path} nicht gefunden.`)
  source = source.replace(before, after)
  await writeFile(path, source)
  return true
}

async function replaceRegexInFile(path, pattern, after, doneMarker, label) {
  let source = await readFile(path, 'utf8')
  if (doneMarker && source.includes(doneMarker)) return false
  assert.ok(pattern.test(source), `${label} wurde in ${path} nicht gefunden.`)
  source = source.replace(pattern, after)
  await writeFile(path, source)
  return true
}

async function removeRegexFromFile(path, pattern) {
  let source = await readFile(path, 'utf8')
  if (!pattern.test(source)) return false
  source = source.replace(pattern, '')
  await writeFile(path, source)
  return true
}

const changed = []
const mark = (path, didChange) => { if (didChange) changed.push(path) }

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /import \{ useCallback, useEffect, useMemo, useRef, useState \} from 'react'\n/,
  "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'\nimport TimesheetPage from './TimesheetPage.jsx'\n",
  "import TimesheetPage from './TimesheetPage.jsx'",
  'Stundenzettel-Import',
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /  \{ key: 'times', label: '[^']+', roles: \['owner', 'admin', 'manager'\] \},/,
  "  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager'] },",
  "{ key: 'timesheet', label: 'Stundenzettel'",
  'Stundenzettel-Navigation',
))

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager', 'employee'] },",
  "  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager'] },",
  'Stundenzettel nur für Verwaltung',
))

mark('frontend/src/App.jsx', await removeRegexFromFile(
  'frontend/src/App.jsx',
  /\n\s*\{ key: 'corrections', label: '[^']+', roles: \[[^\]]+\] \},/,
))

mark('frontend/src/App.jsx', await removeRegexFromFile(
  'frontend/src/App.jsx',
  /\n\s*<button type="button" className=\{page === 'timesheet' \? 'active' : ''\} onClick=\{\(\) => navigate\('timesheet'\)\}>Stundenzettel<\/button>/,
))

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "        <main className=\"employee-kiosk-main\" aria-label={page === 'schedule' ? 'Eigener Dienstplan' : page === 'timesheet' ? 'Eigener Stundenzettel' : 'Mitarbeiter-Zeiterfassung'}>{children}</main>",
  "        <main className=\"employee-kiosk-main\" aria-label={page === 'schedule' ? 'Eigener Dienstplan' : 'Mitarbeiter-Zeiterfassung'}>{children}</main>",
  'Mitarbeiter-Stundenzettel-Bezeichnung entfernen',
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /: page === 'times' \? <TimesPage session=\{session\} \/>/,
  ": page === 'timesheet' ? <TimesheetPage session={session} />",
  "page === 'timesheet' ? <TimesheetPage session={session} />",
  'Stundenzettel-Routing',
))

mark('frontend/src/App.jsx', await removeRegexFromFile(
  'frontend/src/App.jsx',
  /\n\s*: page === 'corrections' \? <CorrectionsPage session=\{session\} \/>/,
))

mark('netlify/functions/_shared/attendance-service.mts', await replaceInFile(
  'netlify/functions/_shared/attendance-service.mts',
  "    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      if (!MANAGEMENT_ROLES.has(current.role)) throw new AttendanceServiceError('Keine Berechtigung.', 403, 'FORBIDDEN')\n      return { entries: await repository.listHistory({ userId: normalizedText(filters.userId), from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },",
  "    async getHistory(actor: Record<string, unknown>, filters: Record<string, unknown> = {}) {\n      const current = requireActor(actor)\n      const historyUserId = current.role === 'employee' ? current.userId : normalizedText(filters.userId)\n      return { entries: await repository.listHistory({ userId: historyUserId, from: normalizedText(filters.from), to: normalizedText(filters.to) }) }\n    },",
  'Mitarbeiter-Eigenhistorie',
))

mark('netlify/functions/attendance.mts', await removeRegexFromFile(
  'netlify/functions/attendance.mts',
  /\s*if \(actor\.role === 'employee'\) return response\(\{ message: 'Keine Berechtigung\.', code: 'FORBIDDEN' \}, 403\)\n/,
))

mark('netlify/functions/timesheet-reports.mts', await replaceInFile(
  'netlify/functions/timesheet-reports.mts',
  'const placeholders = userIds.map((_, index) => `$${index + 4}`).join(\', \')',
  'const placeholders = userIds.map((_, index) => `$${index + 3}`).join(\', \')',
  'Stundenzettel-Report-Parameter',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "import { buildActualSessions, buildPlannedRows, sumMinutes, totalsByEmployee } from './timesheet-utils.js'\n",
  "import { buildActualSessions, buildPlannedRows, sumMinutes, totalsByEmployee } from './timesheet-utils.js'\nimport { berlinDate } from './berlin-date.mjs'\n",
  'Stundenzettel-Berlin-Datum-Import',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "function formatDuration(minutes) {\n  const total = Math.max(0, Number(minutes) || 0)\n  const hours = Math.floor(total / 60)\n  const rest = Math.round(total % 60)\n  return `${hours}:${String(rest).padStart(2, '0')} Std.`\n}\n",
  "function formatDuration(minutes) {\n  const total = Math.max(0, Number(minutes) || 0)\n  const hours = Math.floor(total / 60)\n  const rest = Math.round(total % 60)\n  return `${hours}:${String(rest).padStart(2, '0')} Std.`\n}\n\nfunction addDateDays(value, amount) {\n  const date = new Date(`${value}T12:00:00Z`)\n  date.setUTCDate(date.getUTCDate() + amount)\n  return date.toISOString().slice(0, 10)\n}\n",
  'Stundenzettel-Datumsbereich-Helfer',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "  const today = new Date().toISOString().slice(0, 10)",
  "  const today = berlinDate(new Date())",
  'Stundenzettel-Berlin-Heute',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "  const [editor, setEditor] = useState(null)\n\n  const employeeNames = useMemo(() => {",
  "  const [editor, setEditor] = useState(null)\n  const sessionUserId = session.userId || session.id || ''\n\n  const employeeNames = useMemo(() => {",
  'Stundenzettel-Session-ID',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "    if (session.userId) names.set(String(session.userId), session.fullName || 'Mitarbeiter')\n    return names\n  }, [employees, session.fullName, session.userId])",
  "    if (sessionUserId) names.set(String(sessionUserId), session.fullName || 'Mitarbeiter')\n    return names\n  }, [employees, session.fullName, sessionUserId])",
  'Stundenzettel-Mitarbeitername-Session-ID',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "      const params = new URLSearchParams({ resource: 'history', from, to })\n      if (management && userId) params.set('userId', userId)\n      const data = await requestJson(`/api/attendance?${params}`)\n      setActual({ rows: buildActualSessions(data.entries || [], employeeNames), error: '' })",
  "      const historyTo = addDateDays(to, 1)\n      const params = new URLSearchParams({ resource: 'history', from, to: historyTo })\n      if (management && userId) params.set('userId', userId)\n      const data = await requestJson(`/api/attendance?${params}`)\n      const rows = buildActualSessions(data.entries || [], employeeNames).filter((row) => row.date >= from && row.date <= to)\n      setActual({ rows, error: '' })",
  'Stundenzettel-Nachtschicht-Historie',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "      if (!management) entries = entries.filter((entry) => String(entry.employeeUserId || '') === String(session.userId || '') && entry.status === 'published')",
  "      if (!management) entries = entries.filter((entry) => String(entry.employeeUserId || '') === String(sessionUserId) && entry.status === 'published')",
  'Stundenzettel-Mitarbeiter-Dienstplan-ID',
))

mark('frontend/src/TimesheetPage.jsx', await replaceInFile(
  'frontend/src/TimesheetPage.jsx',
  "  }, [employeeNames, from, management, session.userId, to, userId])",
  "  }, [employeeNames, from, management, sessionUserId, to, userId])",
  'Stundenzettel-Dienstplan-Abhängigkeiten',
))

// Netlify Identity redeems a recovery link into a temporary logged-in session.
// The portal must explicitly stop there and ask for the new password.
mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "  requestPasswordRecovery,\n  signup,\n} from '@netlify/identity'",
  "  requestPasswordRecovery,\n  signup,\n  updateUser,\n} from '@netlify/identity'",
  'Passwort-Reset updateUser Import',
))

const passwordRecoveryScreen = `function PasswordRecoveryScreen({ notice, setNotice, onComplete }) {
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setNotice(null)
    if (password.length < 10) {
      setNotice({ tone: 'error', text: 'Das neue Passwort muss mindestens 10 Zeichen lang sein.' })
      return
    }
    if (password !== repeatPassword) {
      setNotice({ tone: 'error', text: 'Die beiden Passwörter stimmen nicht überein.' })
      return
    }
    setBusy(true)
    try {
      await updateUser({ password })
      await onComplete()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof AuthError ? error.message : error.message || 'Das Passwort konnte nicht gespeichert werden.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Brand />
        <div className="auth-copy">
          <h1>Neues Passwort festlegen.</h1>
          <p>Der Link aus der Wiederherstellungs-E-Mail wurde bestätigt. Lege jetzt ein neues Passwort für das Portal fest.</p>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <Brand compact />
          <h2>Passwort zurücksetzen</h2>
          <p className="muted">Danach kannst du dich wieder normal im Mitarbeiterportal anmelden.</p>
          <Notice notice={notice} onClose={() => setNotice(null)} />
          <form onSubmit={submit} className="form-stack">
            <label>Neues Passwort<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="10" autoComplete="new-password" required /></label>
            <label>Passwort wiederholen<input type="password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} minLength="10" autoComplete="new-password" required /></label>
            <button className="primary-button" disabled={busy}>{busy ? 'Wird gespeichert …' : 'Neues Passwort speichern'}</button>
          </form>
        </div>
      </section>
    </main>
  )
}

`

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /function AuthScreen\(\{ notice, setNotice \}\) \{/,
  `${passwordRecoveryScreen}function AuthScreen({ notice, setNotice }) {`,
  'function PasswordRecoveryScreen(',
  'Passwort-Reset Formular',
))

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "  const [loading, setLoading] = useState(true)\n  const [notice, setNotice] = useState(null)\n\n  const loadSession",
  "  const [loading, setLoading] = useState(true)\n  const [notice, setNotice] = useState(null)\n  const [recovering, setRecovering] = useState(false)\n\n  const loadSession",
  'Passwort-Reset Status',
))

mark('frontend/src/App.jsx', await replaceInFile(
  'frontend/src/App.jsx',
  "        const callback = await handleAuthCallback()\n        if (callback?.type === 'confirmation') setNotice({ tone: 'success', text: 'E-Mail erfolgreich bestätigt.' })\n        const user = await getUser()\n        setIdentityUser(user)\n        await loadSession(user)\n        unsubscribe = onAuthChange(async (_event, currentUser) => { setIdentityUser(currentUser); await loadSession(currentUser) })",
  "        const callback = await handleAuthCallback()\n        if (callback?.type === 'confirmation') setNotice({ tone: 'success', text: 'E-Mail erfolgreich bestätigt.' })\n        if (callback?.type === 'recovery') {\n          const user = callback.user || await getUser()\n          setIdentityUser(user)\n          setSession(null)\n          setRecovering(true)\n          setLoading(false)\n          unsubscribe = onAuthChange(async (_event, currentUser) => { setIdentityUser(currentUser) })\n          return\n        }\n        const user = await getUser()\n        setIdentityUser(user)\n        await loadSession(user)\n        unsubscribe = onAuthChange(async (_event, currentUser) => { setIdentityUser(currentUser); await loadSession(currentUser) })",
  'Passwort-Reset Callback',
))

mark('frontend/src/App.jsx', await replaceRegexInFile(
  'frontend/src/App.jsx',
  /  async function signOut\(\) \{ await logout\(\); setIdentityUser\(null\); setSession\(null\) \}\n  if \(loading\) return <div className="loading-screen"><Brand \/><span>Portal wird sicher geladen …<\/span><\/div>\n  if \(!identityUser \|\| !session\) return <AuthScreen notice=\{notice\} setNotice=\{setNotice\} \/>/,
  "  async function signOut() { await logout(); setIdentityUser(null); setSession(null) }\n  async function finishPasswordRecovery() {\n    await logout()\n    setRecovering(false)\n    setIdentityUser(null)\n    setSession(null)\n    setNotice({ tone: 'success', text: 'Das neue Passwort wurde gespeichert. Du kannst dich jetzt damit anmelden.' })\n  }\n  if (loading) return <div className=\"loading-screen\"><Brand /><span>Portal wird sicher geladen …</span></div>\n  if (recovering) return <PasswordRecoveryScreen notice={notice} setNotice={setNotice} onComplete={finishPasswordRecovery} />\n  if (!identityUser || !session) return <AuthScreen notice={notice} setNotice={setNotice} />",
  'if (recovering) return <PasswordRecoveryScreen',
  'Passwort-Reset Ansicht',
))

console.log(changed.length ? `Stundenzettel feature applied: ${[...new Set(changed)].join(', ')}` : 'Stundenzettel feature already applied')
