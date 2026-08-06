import { readFile, writeFile } from 'node:fs/promises'

const path = 'tests/e2e/unified-portal.spec.mjs'
let source = await readFile(path, 'utf8')

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
"await page.getByLabel('Einsatzort').selectOption('site-nord')",
"await page.getByLabel('Einsatzort', { exact: true }).selectOption('site-nord')",
'exact worksite selector',
)

replaceOnce(
"await expect(page.getByText(/Dienst als Entwurf gespeichert/i)).toBeVisible()",
"await expect(page.getByRole('heading', { name: 'Dienst erstellen' })).toHaveCount(0)",
'schedule save completion',
)

await writeFile(path, source)
console.log('Unified portal browser tests prepared')
