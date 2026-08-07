import { mkdir, readFile, writeFile } from 'node:fs/promises'

const path = 'tests/e2e/unified-portal.spec.mjs'
let source = await readFile(path, 'utf8')
await mkdir('artifacts/unified-preview', { recursive: true })

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: erwartet 1 Treffer, gefunden ${count}`)
  source = source.replace(before, after)
}

replaceOnce(
`async function navigate(page, label) {
  const button = page.getByRole('button', { name: label, exact: true })
  if (!(await button.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Menü öffnen' }).click()
  }
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
}`,
`async function navigate(page, label) {
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(page.locator('.sidebar')).toHaveClass(/open/)
  }
  await page.getByRole('button', { name: label, exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText(label)
}`,
'mobile navigation helper',
)

replaceOnce(
"await expect(page.getByText('Dienst abgeschlossen', { exact: true })).toBeVisible()",
"await expect(page.getByText('Dienst abgeschlossen', { exact: true }).first()).toBeVisible()",
'completed attendance state',
)

replaceOnce(
"await expect(page.getByText('Pause begonnen', { exact: true })).toBeVisible()",
"await expect(page.getByText('Pause begonnen', { exact: true }).first()).toBeVisible()",
'pause started timeline',
)

replaceOnce(
"await expect(page.getByText('Pause beendet', { exact: true })).toBeVisible()",
"await expect(page.getByText('Pause beendet', { exact: true }).first()).toBeVisible()",
'pause ended timeline',
)

replaceOnce(
"await page.getByLabel('Einsatzort').selectOption('site-nord')",
"await page.locator('.schedule-form select').nth(1).selectOption('site-nord')",
'worksite selector',
)

replaceOnce(
"await expect(page.getByText(/Dienst als Entwurf gespeichert/i)).toBeVisible()",
"await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toHaveCount(0)",
'schedule save completion',
)

replaceOnce(
"test('admin uses one portal and settings remain open and save correctly', async ({ page }) => {",
"test('admin uses one portal and settings remain open and save correctly', async ({ page }, testInfo) => {",
'settings screenshot test info',
)
replaceOnce(
"  await expect(page.getByText('buero@habun-security.de')).toBeVisible()",
"  await expect(page.getByText('buero@habun-security.de')).toBeVisible()\n  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/01-einstellungen-iphone.png', fullPage: true })",
'settings screenshot',
)

replaceOnce(
"test('digital attendance supports work, pause, resume and work end', async ({ page }) => {",
"test('digital attendance supports work, pause, resume and work end', async ({ page }, testInfo) => {",
'attendance screenshot test info',
)
replaceOnce(
"  await navigate(page, 'Zeiterfassung')\n  await expect(page.locator('.digital-clock')).toHaveText(/^\\d{2}:\\d{2}:\\d{2}$/)",
"  await navigate(page, 'Zeiterfassung')\n  await expect(page.locator('.digital-clock')).toHaveText(/^\\d{2}:\\d{2}:\\d{2}$/)\n  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/02-zeiterfassung-iphone.png', fullPage: true })",
'attendance screenshot',
)

replaceOnce(
"test('mobile schedule opens a simple editor from a day card', async ({ page }) => {",
"test('mobile schedule opens a simple editor from a day card', async ({ page }, testInfo) => {",
'schedule screenshot test info',
)
replaceOnce(
"  await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toBeVisible()",
"  await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toBeVisible()\n  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/03-dienstplan-iphone.png', fullPage: true })",
'schedule screenshot',
)

replaceOnce(
"test('reports provide PDF preview, PDF download and Excel download', async ({ page }) => {",
"test('reports provide PDF preview, PDF download and Excel download', async ({ page }, testInfo) => {",
'reports screenshot test info',
)
replaceOnce(
"  await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()",
"  if (testInfo.project.name === 'iphone-chromium') {\n    await expect(page.getByTitle('PDF-Vorschau')).toBeHidden()\n    await expect(page.locator('[data-ios-pdf-fallback=\"true\"]')).toBeVisible()\n    await expect(page.locator('[data-ios-pdf-open=\"true\"]')).toHaveAttribute('href', /^blob:/)\n  } else {\n    await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()\n  }\n  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/04-berichte-iphone.png', fullPage: true })",
'reports iPhone PDF fallback and screenshot',
)
replaceOnce(
"  const pdfDownload = page.waitForEvent('download')",
"  const pdfDownload = page.waitForEvent('download', { predicate: (download) => /\\.pdf$/i.test(download.suggestedFilename()) })",
'PDF download predicate',
)
replaceOnce(
"  const excelDownload = page.waitForEvent('download')",
"  const excelDownload = page.waitForEvent('download', { predicate: (download) => /\\.xlsx$/i.test(download.suggestedFilename()) })",
'Excel download predicate',
)

const attendanceEditMarker = "test('admin can edit an employee attendance session directly'"
if (!source.includes(attendanceEditMarker)) {
  source += `

test('admin can edit an employee attendance session directly', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Zeiterfassung')
  await page.getByRole('button', { name: /Arbeit beginnen/ }).click()
  await page.getByRole('button', { name: 'Arbeit beenden' }).click()

  let editPayload = null
  await page.route('**/api/attendance-edit', async (route) => {
    editPayload = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saved: true, ...editPayload }) })
  })
  page.on('dialog', (browserDialog) => browserDialog.accept())

  await navigate(page, 'Zeiten')
  await page.getByLabel('Mitarbeiter').selectOption('employee-anna')
  await expect(page.getByRole('button', { name: 'Bearbeiten' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Bearbeiten' }).first().click()
  await expect(page.getByRole('heading', { name: 'Arbeitszeit bearbeiten' })).toBeVisible()
  await page.getByLabel('Pause in Minuten').fill('1')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect.poll(() => editPayload).not.toBeNull()
  expect(editPayload.action).toBe('edit-session')
  expect(editPayload.userId).toBe('employee-anna')
  expect(editPayload.pauseMinutes).toBe(1)
})
`
}

await writeFile(path, source)
console.log('Unified portal browser tests prepared')
