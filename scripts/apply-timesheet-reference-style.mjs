import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const reportPath = 'netlify/functions/timesheet-monthly-reports.mts'
let source = await readFile(reportPath, 'utf8')

// Restore the exact visual hierarchy from the supplied Arbeitszeitenbericht reference.
source = source
  .replace("workbook.subject = 'Stundenzettel'", "workbook.subject = 'Arbeitszeitenbericht'")
  .replace("workbook.title = 'Stundenzettel'", "workbook.title = 'Arbeitszeitenbericht'")
  .replace("sheet.getCell('A1').value = 'Stundenzettel'", "sheet.getCell('A1').value = 'Arbeitszeitenbericht'")
  .replace("page.drawText('Stundenzettel', { x: 225, y: height - 38, size: 15, font: bold, color: dark })", "page.drawText('Arbeitszeitenbericht', { x: 193, y: height - 38, size: 15, font: bold, color: dark })")

const compactLogo = `    const drawWatermark = () => {
      if (!logo) return
      const scale = Math.min(88 / logo.width, 88 / logo.height)
      const logoWidth = logo.width * scale
      const logoHeight = logo.height * scale
      page.drawImage(logo, {
        x: (width - logoWidth) / 2,
        y: 285,
        width: logoWidth,
        height: logoHeight,
        opacity: 1,
      })
    }`
const referenceWatermark = `    const drawWatermark = () => {
      if (!logo) return
      const scale = Math.min(205 / logo.width, 170 / logo.height)
      const logoWidth = logo.width * scale
      const logoHeight = logo.height * scale
      page.drawImage(logo, {
        x: (width - logoWidth) / 2,
        y: 285,
        width: logoWidth,
        height: logoHeight,
        opacity: 0.06,
      })
    }`
if (source.includes(compactLogo)) source = source.replace(compactLogo, referenceWatermark)
assert.ok(source.includes('const scale = Math.min(205 / logo.width, 170 / logo.height)'), 'Großes PDF-Wasserzeichen fehlt.')
assert.ok(source.includes('opacity: 0.06'), 'Helles PDF-Wasserzeichen fehlt.')

// Match the old reference footer: only the company name at bottom-left.
source = source.replace(
  "const companyLine = [settings.companyName, settings.address, settings.phone, settings.email].filter(Boolean).join(' · ')",
  "const companyLine = settings.companyName || 'HABUN Security & Gebäudereinigung'",
)
source = source.replace(
  "const footerText = [settings.companyName, settings.address, settings.phone, settings.email].filter(Boolean).join(' · ')",
  "const footerText = settings.companyName || 'HABUN Security & Gebäudereinigung'",
)
source = source.replace(
  "sheet.headerFooter.oddFooter = `&L&8${text(footerText, 150)}&R&8Seite &P von &N`",
  "sheet.headerFooter.oddFooter = `&L&8${text(footerText, 80)}`",
)

// Keep Excel in the same report layout and make the shield prominent in the same lower section.
source = source.replace(
  "tl: { col: 1.55, row: notesEnd + 1.1 },\n        ext: { width: 82, height: 82 },",
  "tl: { col: 1.6, row: notesStart + 0.65 },\n        ext: { width: 180, height: 150 },",
)

await writeFile(reportPath, source)

// The legacy PDF source test is rewritten during verify because build reruns verification in-place.
const pdfTestPath = 'scripts/timesheet-monthly-pdf-layout-source-test.mjs'
let pdfTest = await readFile(pdfTestPath, 'utf8')
pdfTest = pdfTest
  .replace("assert.match(source, /page\\.drawText\\('Stundenzettel'/)", "assert.match(source, /page\\.drawText\\('Arbeitszeitenbericht'/)")
  .replace("assert.doesNotMatch(source, /Arbeitszeitenbericht/)\n", '')
  .replace("assert.match(source, /opacity:\\s*1/)", "assert.match(source, /Math\\.min\\(205 \\/ logo\\.width, 170 \\/ logo\\.height\\)/)\nassert.match(source, /opacity:\\s*0\\.06/)")
await writeFile(pdfTestPath, pdfTest)

console.log('Arbeitszeitenbericht reference layout restored for PDF and Excel')
