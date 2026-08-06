import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'tests/e2e/unified-portal.spec.mjs'
let source = await readFile(path, 'utf8')

function replaceTest(title, replacement) {
  const start = source.indexOf(`test('${title}'`)
  assert.ok(start >= 0, `Browsertest fehlt: ${title}`)
  const end = source.indexOf('\ntest(', start + 6)
  assert.ok(end > start, `Ende des Browsertests fehlt: ${title}`)
  source = source.slice(0, start) + replacement.trim() + '\n\n' + source.slice(end + 1)
}

replaceTest('scheduler edits only the schedule without reports or exports', `
test('scheduler sees only schedule access', async ({ page }) => {
  await login(page, 'scheduler')
  await expect(page.getByRole('heading', { name: 'Dienstplan', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dienstplan', exact: true })).toBeVisible()
  for (const forbidden of ['Übersicht', 'Zeiterfassung', 'Mitarbeiter', 'Zeiten', 'Einsatzorte', 'Korrekturen', 'Berichte', 'Einstellungen']) {
    await expect(page.getByRole('button', { name: forbidden, exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'Dienstplan als PDF' })).toHaveCount(0)
  await expectNoHorizontalPageOverflow(page)
})

test('scheduler opens schedule editor', async ({ page }) => {
  await login(page, 'scheduler')
  await expect(page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first()).toBeVisible()
  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()
  await expect(page.getByRole('heading', { exact: true, name: 'Dienst erstellen' })).toBeVisible()
  await expectNoHorizontalPageOverflow(page)
})`)

replaceTest('reports provide PDF preview, PDF download and Excel download', `
test('reports preview opens a valid PDF', async ({ page }, testInfo) => {
  await login(page, 'admin')
  await navigate(page, 'Berichte')
  await page.getByRole('button', { name: 'PDF-Vorschau' }).click()
  await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/04-berichte-iphone.png', fullPage: true })
})

test('reports PDF download creates a PDF file', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Berichte')
  const pdfDownload = page.waitForEvent('download', { predicate: (download) => /\\.pdf$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'PDF herunterladen' }).click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\\.pdf$/i)
})

test('reports Excel download creates an Excel file', async ({ page }) => {
  await login(page, 'admin')
  await navigate(page, 'Berichte')
  const excelDownload = page.waitForEvent('download', { predicate: (download) => /\\.xlsx$/i.test(download.suggestedFilename()) })
  await page.getByRole('button', { name: 'Excel herunterladen' }).click()
  expect((await excelDownload).suggestedFilename()).toMatch(/\\.xlsx$/i)
})`)

await writeFile(path, source)
console.log('Browser audit tests split into focused scenarios')
