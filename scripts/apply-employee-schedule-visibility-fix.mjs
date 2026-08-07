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
if (!app.includes('const employeeSessionUserId = session.userId || session.id')) {
  const oldBlock = `  const visibleEntries = useMemo(() => management\n    ? entries\n    : entries.filter((entry) => entry.employeeUserId === session.userId && entry.status === 'published'), [entries, management, session.userId])`
  const newBlock = `  const employeeSessionUserId = session.userId || session.id\n  const visibleEntries = useMemo(() => management\n    ? entries\n    : entries.filter((entry) => String(entry.employeeUserId || '') === String(employeeSessionUserId || '') && entry.status === 'published'), [entries, management, employeeSessionUserId])`
  assert.ok(app.includes(oldBlock), 'Mitarbeiter-Dienstplan-Filter-Marker fehlt.')
  app = app.replace(oldBlock, newBlock)
  await writeFile(appPath, app)
}

const browserPath = 'tests/e2e/unified-portal.spec.mjs'
let browser = await readFile(browserPath, 'utf8')
if (!browser.includes("role === 'employee' ? { id: 'employee-anna'")) {
  const oldSession = `    body: JSON.stringify({ userId: role === 'employee' ? 'employee-anna' : 'admin-1', email: role === 'employee' ? 'anna@example.test' : 'admin@example.test', fullName: role === 'employee' ? 'Anna Beispiel' : 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),`
  const newSession = `    body: JSON.stringify(role === 'employee'\n      ? { id: 'employee-anna', email: 'anna@example.test', fullName: 'Anna Beispiel', role, employeeCount: employees.length, location: 'Objekt Nord' }\n      : { userId: 'admin-1', email: 'admin@example.test', fullName: 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),`
  assert.ok(browser.includes(oldSession), 'Browser-Session-Mock-Marker fehlt.')
  browser = browser.replace(oldSession, newSession)
  await writeFile(browserPath, browser)
}

console.log('Employee published schedule visibility fix applied')
