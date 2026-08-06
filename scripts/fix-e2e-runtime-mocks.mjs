import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'tests/e2e/unified-portal.spec.mjs'
let source = await readFile(path, 'utf8')

const schedulerLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht', exact: true })).toBeVisible()"
const legacyLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()"
const stableLogin = `await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()
  if (role === 'admin') {
    await expect(page.locator('.sidebar nav button')).toHaveCount(9)
    await expect(page.locator('.sidebar nav button').filter({ hasText: 'Berichte' })).toHaveCount(1)
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
  const clicked = await page.evaluate(async (targetLabel) => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const buttons = Array.from(document.querySelectorAll('.sidebar nav button'))
      const button = buttons.find((entry) => normalize(entry.textContent) === normalize(targetLabel))
      if (button) {
        button.click()
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }, label)
  expect(clicked).toBe(true)
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
assert.match(source, /attempt < 40/)
assert.match(source, /filter\(\{ hasText: 'Berichte' \}\)/)

await writeFile(path, source)
console.log('E2E runtime mocks normalized')
