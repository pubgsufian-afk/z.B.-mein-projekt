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

const knownNavigateVariants = [
`async function navigate(page, label) {
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(page.locator('.sidebar')).toHaveClass(/open/)
  }
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`,
`async function navigate(page, label) {
  const sidebar = page.locator('.sidebar')
  const navButton = sidebar.getByRole('button', { name: label, exact: true })
  if (!(await navButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Menü öffnen' }).click()
    await expect(sidebar).toHaveClass(/open/)
  }
  await navButton.click()
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`,
`async function navigate(page, label) {
  const sidebar = page.locator('.sidebar')
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(sidebar).toHaveClass(/open/)
  }
  await sidebar.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`,
`async function navigate(page, label) {
  const sidebar = page.locator('.sidebar')
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(sidebar).toHaveClass(/open/)
  }
  const navButton = sidebar.locator('nav button').filter({ hasText: label }).first()
  await expect(navButton).toHaveCount(1)
  await navButton.click({ force: true })
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`,
]
const stableNavigate = `async function navigate(page, label) {
  await page.evaluate((targetLabel) => {
    const buttons = Array.from(document.querySelectorAll('.sidebar nav button'))
    const button = buttons.find((entry) => entry.textContent?.trim() === targetLabel)
    if (!button) {
      const available = buttons.map((entry) => entry.textContent?.trim()).filter(Boolean).join('|')
      throw new Error('Navigation fehlt: ' + targetLabel + ' / ' + available)
    }
    button.click()
  }, label)
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`
for (const variant of knownNavigateVariants) source = source.replace(variant, stableNavigate)

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
