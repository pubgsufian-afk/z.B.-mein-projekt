import { readFile, writeFile } from 'node:fs/promises'

const cssPath = 'frontend/src/styles.css'
let css = await readFile(cssPath, 'utf8')
const marker = '/* HABUN_LOGO_VISIBILITY_AUDIT */'
if (!css.includes(marker)) {
  css = `${css.trimEnd()}

${marker}
.brand > .brand-mark { margin-top: 0; color: inherit; font-size: inherit; }
.brand-mark { isolation: isolate; }
.brand-mark img {
  width: 220px !important;
  height: auto !important;
  max-width: none;
  object-fit: contain;
  object-position: center;
  filter: none;
}
.brand-compact .brand-mark img { width: 178px !important; height: auto !important; }

@media (max-width: 900px) {
  .topbar-logo .brand-mark {
    width: 64px;
    height: 64px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--surface-2);
  }
  .topbar-logo .brand-mark img { width: 190px !important; height: auto !important; }
}

@media (max-width: 680px) {
  .employee-kiosk-header .brand-mark { width: 76px; height: 76px; }
  .employee-kiosk-header .brand-mark img { width: 226px !important; height: auto !important; }
}
`
  await writeFile(cssPath, css)
}

const e2ePath = 'tests/e2e/unified-portal.spec.mjs'
let e2e = await readFile(e2ePath, 'utf8')
const oldHeader = "test('employee sees only the kiosk clock and no portal data', async ({ page }) => {"
const newHeader = "test('employee sees only the kiosk clock and no portal data', async ({ page }, testInfo) => {"
if (e2e.includes(oldHeader)) e2e = e2e.replace(oldHeader, newHeader)

const oldChecks = `  await expect(page.getByRole('img', { name: 'Habun Security' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Menü öffnen' })).toHaveCount(0)
  await expect(page.getByText(/Übersicht|Dienstplan|Meine Zeiten|Zeiten|Korrekturen|Berichte|PDF|Excel|Gesamt|Heutige Buchungen/i)).toHaveCount(0)
  await expect(page.locator('.digital-clock')).toHaveText(/^\\d{2}:\\d{2}:\\d{2}$/)`
const newChecks = `  await expect(page.getByRole('img', { name: 'Habun Security' })).toBeVisible()
  const brandMark = page.locator('.employee-kiosk-header .brand-mark')
  await expect(brandMark).toBeVisible()
  const brandBox = await brandMark.boundingBox()
  expect(brandBox?.width || 0).toBeGreaterThanOrEqual(70)
  expect(brandBox?.height || 0).toBeGreaterThanOrEqual(70)
  await expect(page.getByRole('button', { name: 'Menü öffnen' })).toHaveCount(0)
  await expect(page.getByText(/Übersicht|Dienstplan|Heutiger Dienst|Meine Zeiten|Zeiten|Korrekturen|Berichte|PDF|Excel|Gesamt|Heutige Buchungen/i)).toHaveCount(0)
  await expect(page.locator('.digital-clock')).toHaveText(/^\\d{2}:\\d{2}:\\d{2}$/)
  if (testInfo.project.name === 'iphone-chromium') await page.screenshot({ path: 'artifacts/unified-preview/05-mitarbeiter-stempeluhr-iphone.png', fullPage: true })
  if (testInfo.project.name === 'android-chromium') await page.screenshot({ path: 'artifacts/unified-preview/06-mitarbeiter-stempeluhr-android.png', fullPage: true })`
if (e2e.includes(oldChecks)) e2e = e2e.replace(oldChecks, newChecks)
else if (!e2e.includes('05-mitarbeiter-stempeluhr-iphone.png')) throw new Error('Mitarbeiter-Prüfblock nicht gefunden.')
await writeFile(e2ePath, e2e)

console.log('Employee kiosk visual audit finalized')
