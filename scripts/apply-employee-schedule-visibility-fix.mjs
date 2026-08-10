import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const sessionPath = 'netlify/functions/session.mts'
let session = await readFile(sessionPath, 'utf8')
if (!session.includes('userId: data.userId || data.id')) {
  assert.ok(session.includes('userId: data.userId,'), 'Mitarbeiter-Session-ID-Marker fehlt.')
  session = session.replace('userId: data.userId,', 'userId: data.userId || data.id,')
  await writeFile(sessionPath, session)
}

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
if (!app.includes('const visibleEntries = entries')) {
  const oldBlock = `  const visibleEntries = useMemo(() => management\n    ? entries\n    : entries.filter((entry) => entry.employeeUserId === session.userId && entry.status === 'published'), [entries, management, session.userId])`
  const idFallbackBlock = `  const employeeSessionUserId = session.userId || session.id\n  const visibleEntries = useMemo(() => management\n    ? entries\n    : entries.filter((entry) => String(entry.employeeUserId || '') === String(employeeSessionUserId || '') && entry.status === 'published'), [entries, management, employeeSessionUserId])`
  const currentBlock = app.includes(idFallbackBlock) ? idFallbackBlock : oldBlock
  assert.ok(app.includes(currentBlock), 'Mitarbeiter-Dienstplan-Filter-Marker fehlt.')
  // /api/schedule-v2 already scopes employee responses server-side to the authenticated
  // Identity user and published shifts. A second client-side session-ID comparison can
  // hide valid rows when the proxied /api/session uses a different legacy identifier.
  app = app.replace(currentBlock, '  const visibleEntries = entries')
  await writeFile(appPath, app)
}

const browserPath = 'tests/e2e/unified-portal.spec.mjs'
let browser = await readFile(browserPath, 'utf8')
const employeeIdMismatchMockApplied = browser.includes("? { id: 'legacy-session-anna', email: 'anna@example.test'")
if (!employeeIdMismatchMockApplied) {
  const oldSession = `    body: JSON.stringify({ userId: role === 'employee' ? 'employee-anna' : 'admin-1', email: role === 'employee' ? 'anna@example.test' : 'admin@example.test', fullName: role === 'employee' ? 'Anna Beispiel' : 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),`
  const previousPatchedSession = `    body: JSON.stringify(role === 'employee'\n      ? { id: 'employee-anna', email: 'anna@example.test', fullName: 'Anna Beispiel', role, employeeCount: employees.length, location: 'Objekt Nord' }\n      : { userId: 'admin-1', email: 'admin@example.test', fullName: 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),`
  const newSession = `    body: JSON.stringify(role === 'employee'\n      ? { id: 'legacy-session-anna', email: 'anna@example.test', fullName: 'Anna Beispiel', role, employeeCount: employees.length, location: 'Objekt Nord' }\n      : { userId: 'admin-1', email: 'admin@example.test', fullName: 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),`
  const currentSession = browser.includes(previousPatchedSession) ? previousPatchedSession : oldSession
  assert.ok(browser.includes(currentSession), 'Browser-Session-Mock-Marker fehlt.')
  browser = browser.replace(currentSession, newSession)
  await writeFile(browserPath, browser)
}

console.log('Employee published schedule visibility fix applied')
