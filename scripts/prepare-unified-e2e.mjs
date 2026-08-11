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

const reportTest = `test('Stundenzettel and Stempelprotokoll keep PDF and Excel downloads', async ({ page }, testInfo) => {
  await login(page, 'admin')
  await page.route('**/api/timesheets**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], months: [] }) }))
  await page.route('**/api/timesheet-reports', async (route) => {
    const format = route.request().postDataJSON().format
    if (format === 'xlsx') return route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'Content-Disposition': 'attachment; filename="Habun-Stundenzettel.xlsx"' },
      body: Buffer.from('PK\\u0003\\u0004timesheet-xlsx'),
    })
    return route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: { 'Content-Disposition': 'attachment; filename="Habun-Stundenzettel.pdf"' },
      body: Buffer.from('%PDF-1.4\\n%%EOF'),
    })
  })
  await page.route('**/api/stamp-comparison-reports', async (route) => {
    const format = route.request().postDataJSON().format
    if (format === 'xlsx') return route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'Content-Disposition': 'attachment; filename="Habun-Stempelprotokoll.xlsx"' },
      body: Buffer.from('PK\\u0003\\u0004stamp-xlsx'),
    })
    return route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: { 'Content-Disposition': 'attachment; filename="Habun-Stempelprotokoll.pdf"' },
      body: Buffer.from('%PDF-1.4\\n%%EOF'),
    })
  })

  await navigate(page, 'Stundenzettel')
  await expect(page.getByRole('button', { name: 'Berichte', exact: true })).toHaveCount(0)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/04-stundenzettel-iphone.png', fullPage: true })

  const pdfDownload = page.waitForEvent('download', { predicate: (download) => /\\.pdf$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\\.pdf$/i)

  const excelDownload = page.waitForEvent('download', { predicate: (download) => /\\.xlsx$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  expect((await excelDownload).suggestedFilename()).toMatch(/\\.xlsx$/i)

  await navigate(page, 'Stempelprotokoll')
  const stampPdfDownload = page.waitForEvent('download', { predicate: (download) => /\\.pdf$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Stempelprotokoll PDF' }).click()
  expect((await stampPdfDownload).suggestedFilename()).toMatch(/\\.pdf$/i)

  const stampExcelDownload = page.waitForEvent('download', { predicate: (download) => /\\.xlsx$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Stempelprotokoll Excel' }).click()
  expect((await stampExcelDownload).suggestedFilename()).toMatch(/\\.xlsx$/i)
})
`

const oldReportStart = source.indexOf("test('reports provide PDF preview, PDF download and Excel download'")
const newReportStart = source.indexOf("test('Stundenzettel and Stempelprotokoll keep PDF and Excel downloads'")
const reportStart = oldReportStart >= 0 ? oldReportStart : newReportStart
const reportEndMarker = "\ntest('employee sees only clock and own published schedule'"
const reportEnd = reportStart >= 0 ? source.indexOf(reportEndMarker, reportStart) : -1
if (reportStart < 0 || reportEnd < 0) throw new Error('Report-Download-E2E-Testblock wurde nicht gefunden.')
source = `${source.slice(0, reportStart)}${reportTest}${source.slice(reportEnd + 1)}`

await writeFile(path, source)
console.log('Unified portal browser tests prepared')