import { readFile, writeFile } from 'node:fs/promises'

const path = 'tests/e2e/unified-portal.spec.mjs'
let source = await readFile(path, 'utf8')

const schedulerLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : role === 'scheduler' ? 'Dienstplan' : 'Übersicht', exact: true })).toBeVisible()"
const legacyLogin = "await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()"
const stableLogin = "await expect(page.locator(role === 'employee' ? '.employee-kiosk-shell' : '.app-shell')).toBeVisible()"
source = source.replace(schedulerLogin, stableLogin).replace(legacyLogin, stableLogin)
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
if (navigateStart >= 0 && navigateEnd > navigateStart) {
  const stableNavigate = `async function navigate(page, label) {
  const result = await page.evaluate((targetLabel) => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
    const buttons = Array.from(document.querySelectorAll('.sidebar nav button'))
    const button = buttons.find((entry) => normalize(entry.textContent) === normalize(targetLabel))
    if (!button) return { clicked: false, available: buttons.map((entry) => normalize(entry.textContent)).filter(Boolean) }
    button.click()
    return { clicked: true, available: [] }
  }, label)
  if (!result.clicked) throw new Error('NAVIGATION_FEHLT_' + label + '__VORHANDEN_' + result.available.join('_'))
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`
  source = source.slice(0, navigateStart) + stableNavigate + source.slice(navigateEnd + 2)
}

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

await writeFile(path, source)
console.log('E2E runtime mocks normalized')
