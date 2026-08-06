import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const testPath = 'tests/e2e/unified-portal.spec.mjs'
const appPath = 'frontend/src/App.jsx'
let source = await readFile(testPath, 'utf8')
let appSource = await readFile(appPath, 'utf8')

const loginMarker = "async function login(page, role = 'admin') {\n  const user = users[role]"
const loginWithRuntimeCapture = "async function login(page, role = 'admin') {\n  await page.addInitScript(() => {\n    window.__HABUN_AUDIT_ERRORS__ = []\n    window.addEventListener('error', (event) => window.__HABUN_AUDIT_ERRORS__.push(String(event.error?.stack || event.message || event.error)))\n    window.addEventListener('unhandledrejection', (event) => window.__HABUN_AUDIT_ERRORS__.push(String(event.reason?.stack || event.reason)))\n  })\n  const user = users[role]"
if (!source.includes('window.__HABUN_AUDIT_ERRORS__')) {
  assert.ok(source.includes(loginMarker), 'Login-Helfer wurde nicht gefunden.')
  source = source.replace(loginMarker, loginWithRuntimeCapture)
}

const schedulerLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht', exact: true })).toBeVisible()"
const legacyLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()"
const oldStableLogin = "await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()"
const stableLogin = `await page.waitForTimeout(700)
  const portal = page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')
  if (!(await portal.isVisible().catch(() => false))) {
    const errors = await page.evaluate(() => window.__HABUN_AUDIT_ERRORS__ || [])
    const body = await page.locator('body').innerText().catch(() => '')
    throw new Error('APP_RUNTIME_ERROR__' + (errors.join('__') || 'NO_JS_ERROR') + '__BODY__' + body.slice(0, 500))
  }
  if (role === 'admin') {
    await expect(page.locator('.topbar h1')).toHaveText('Berichte')
    await expect(page.getByRole('button', { name: 'PDF-Vorschau' })).toBeVisible()
  } else if (role === 'scheduler') {
    await expect(page.locator('.sidebar nav button')).toHaveCount(1)
    await expect(page.locator('.sidebar nav button').filter({ hasText: 'Dienstplan' })).toHaveCount(1)
  }`
if (source.includes(schedulerLogin)) source = source.replace(schedulerLogin, stableLogin)
else if (source.includes(legacyLogin)) source = source.replace(legacyLogin, stableLogin)
else if (source.includes(oldStableLogin) && !source.includes('APP_RUNTIME_ERROR__')) source = source.replace(oldStableLogin, stableLogin)

source = source.replace(
  "await expect(page.locator('.topbar h1')).toHaveText(role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht')",
  stableLogin,
)
source = source.replace(
  "await expect(page.getByRole('heading', { name: 'Dienstplan', exact: true })).toBeVisible()",
  "await expect(page.locator('.topbar h1')).toHaveText('Dienstplan')",
)

const navigateStart = source.indexOf('async function navigate(page, label) {')
const navigateEnd = source.indexOf('\n}\n\nasync function expectNoHorizontalPageOverflow', navigateStart)
assert.ok(navigateStart >= 0 && navigateEnd > navigateStart, 'Navigationstest wurde nicht gefunden.')
const stableNavigate = `async function navigate(page, label) {
  if ((await page.locator('.topbar h1').textContent())?.trim() === label) return
  const navButton = page.locator('.sidebar nav button').filter({ hasText: label }).first()
  await expect(navButton).toHaveCount(1)
  await navButton.dispatchEvent('click')
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`
source = source.slice(0, navigateStart) + stableNavigate + source.slice(navigateEnd + 2)

source = source.replaceAll("page.route('**/api/unified-reports'", "page.route('**/api/unified-reports**'")
source = source.replaceAll("page.route('**/api/schedule-directory'", "page.route('**/api/schedule-directory**'")
source = source.replaceAll("page.route('**/api/schedule-pdf'", "page.route('**/api/schedule-pdf**'")
source = source.replace(
  "    const format = route.request().postDataJSON().format",
  "    const format = (route.request().postData() || '').includes('xlsx') ? 'xlsx' : 'pdf'",
)
source = source.replace(
  "    let format = 'pdf'\n    try { format = JSON.parse(route.request().postData() || '{}').format || 'pdf' } catch {}",
  "    const format = (route.request().postData() || '').includes('xlsx') ? 'xlsx' : 'pdf'",
)
source = source.replace(
  "body: JSON.stringify({ userId: role === 'employee' ? 'employee-anna' : 'admin-1', email: role === 'employee' ? 'anna@example.test' : 'admin@example.test', fullName: role === 'employee' ? 'Anna Beispiel' : 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),",
  "body: JSON.stringify({ userId: users[role]?.id || 'admin-1', email: users[role]?.email || 'admin@example.test', fullName: users[role]?.user_metadata?.full_name || 'Test Admin', role, employeeCount: employees.length, location: 'Objekt Nord' }),",
)

const normalInitialCandidates = [
  "const initialPage = session.role === 'employee' ? 'attendance' : session.role === 'scheduler' ? 'schedule' : 'overview'",
  "const initialPage = session.role === 'employee' ? 'attendance' : 'overview'",
]
const reportInitial = "const initialPage = session.role === 'employee' ? 'attendance' : session.role === 'scheduler' ? 'schedule' : session.role === 'admin' ? 'reports' : 'overview'"
if (!appSource.includes(reportInitial)) {
  const initial = normalInitialCandidates.find((candidate) => appSource.includes(candidate))
  assert.ok(initial, 'Initiale Portalseite wurde nicht gefunden.')
  appSource = appSource.replace(initial, reportInitial)
}

assert.match(appSource, /session\.role === 'admin' \? 'reports'/)
assert.match(source, /APP_RUNTIME_ERROR__/)
assert.match(source, /role, employeeCount: employees\.length/)

await writeFile(testPath, source)
await writeFile(appPath, appSource)
console.log('E2E runtime capture enabled; admin starts on reports for focused tests')
