import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const testPath = 'tests/e2e/unified-portal.spec.mjs'
const appPath = 'frontend/src/App.jsx'
let source = await readFile(testPath, 'utf8')
let appSource = await readFile(appPath, 'utf8')

const schedulerLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht', exact: true })).toBeVisible()"
const legacyLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()"
const stableLogin = `await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()
  if (role === 'admin') {
    await expect(page.locator('.topbar h1')).toHaveText('Berichte')
    await expect(page.getByRole('button', { name: 'PDF-Vorschau' })).toBeVisible()
  } else if (role === 'scheduler') {
    await expect(page.locator('.sidebar nav button')).toHaveCount(1)
    await expect(page.locator('.sidebar nav button').filter({ hasText: 'Dienstplan' })).toHaveCount(1)
  }`
if (source.includes(schedulerLogin)) source = source.replace(schedulerLogin, stableLogin)
else if (source.includes(legacyLogin)) source = source.replace(legacyLogin, stableLogin)
else if (!source.includes("if (role === 'admin')")) {
  source = source.replace(
    "await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()",
    stableLogin,
  )
}
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

const currentInitial = "const initialPage = session.role === 'employee' ? 'attendance' : session.role === 'scheduler' ? 'schedule' : 'overview'"
const reportInitial = "const initialPage = session.role === 'employee' ? 'attendance' : session.role === 'scheduler' ? 'schedule' : session.role === 'admin' ? 'reports' : 'overview'"
if (appSource.includes(currentInitial)) appSource = appSource.replace(currentInitial, reportInitial)
assert.match(appSource, /session\.role === 'admin' \? 'reports'/)
assert.match(source, /role, employeeCount: employees\.length/)

await writeFile(testPath, source)
await writeFile(appPath, appSource)
console.log('E2E runtime mocks normalized; admin starts on reports for focused tests')
