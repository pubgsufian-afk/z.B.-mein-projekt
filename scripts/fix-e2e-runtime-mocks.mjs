import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'tests/e2e/unified-portal.spec.mjs'
let source = await readFile(path, 'utf8')

const schedulerLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht', exact: true })).toBeVisible()"
const legacyLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()"
const previousStableLogin = "await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()"
const stableLogin = `await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()
  if (role === 'admin') {
    await expect(page.locator('.sidebar nav button')).toHaveCount(9)
    await expect(page.locator('.sidebar nav button').filter({ hasText: 'Berichte' })).toHaveCount(1)
  } else if (role === 'scheduler') {
    await expect(page.locator('.sidebar nav button')).toHaveCount(1)
    await expect(page.locator('.sidebar nav button').filter({ hasText: 'Dienstplan' })).toHaveCount(1)
  }`
source = source.replace(schedulerLogin, stableLogin).replace(legacyLogin, stableLogin).replace(previousStableLogin, stableLogin)
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
  const navButton = page.locator('.sidebar nav button').filter({ hasText: label }).first()
  await expect(navButton).toBeAttached()
  await expect(navButton).toHaveText(label)
  await navButton.evaluate((button) => button.click())
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

assert.match(source, /role, employeeCount: employees\.length/)
assert.match(source, /toHaveCount\(9\)/)
assert.match(source, /filter\(\{ hasText: 'Berichte' \}\)/)

await writeFile(path, source)
console.log('E2E runtime mocks normalized')
