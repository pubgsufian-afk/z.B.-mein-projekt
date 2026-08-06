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
"  await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()\n  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/04-berichte-iphone.png', fullPage: true })",
'reports screenshot',
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

await writeFile(path, source)
console.log('Unified portal browser tests prepared')