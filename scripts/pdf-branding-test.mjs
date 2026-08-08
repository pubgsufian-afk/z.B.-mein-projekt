import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, legacySource, brandingSource, shieldSource] = await Promise.all([
  readFile('netlify/functions/unified-reports.mts', 'utf8'),
  readFile('netlify/functions/reports-v2.mts', 'utf8'),
  readFile('netlify/functions/_shared/pdf-branding.mts', 'utf8'),
  readFile('netlify/functions/_shared/pdf-shield-logo.mts', 'utf8'),
])

for (const reportSource of [source, legacySource]) {
  assert.doesNotMatch(reportSource, /cardinality\(\$3::text\[\]\)/)
  assert.doesNotMatch(reportSource, /ANY\(\$3::text\[\]\)/)
  assert.match(reportSource, /buildEmployeeFilter/)
  assert.match(reportSource, /user_id IN \(/)
  assert.match(reportSource, /'\$' \+ \(index \+ 3\)/)
  assert.match(reportSource, /\[from, to, \.\.\.employeeFilter\.params\]/)
}

assert.match(source, /readCompanySettings/)
assert.match(source, /loadOriginalLogo/)
assert.match(source, /drawCenteredPdfWatermark/)
assert.match(source, /settings\.companyName/)
assert.match(source, /settings\.phone/)
assert.match(source, /settings\.email/)
assert.doesNotMatch(source, /fetch\(new URL\(settings\.logoUrl/)
assert.match(brandingSource, /readPdfLogoBytes/)
assert.match(brandingSource, /EXPORT_LOGO_PNG_BASE64/)
assert.match(shieldSource, /readPdfLogoBytes/)
assert.match(shieldSource, /embedPng/)
assert.match(source, /application\/pdf/)
assert.match(source, /spreadsheetml/)
assert.match(source, /Arbeitszeiten/)
assert.match(source, /Summen/)
assert.doesNotMatch(source, /Personalnummer|Mitarbeiter-ID|Unterschrift/i)

const { PDFDocument, StandardFonts } = await import('pdf-lib')
const pdf = await PDFDocument.create()
const page = pdf.addPage([595, 842])
const font = await pdf.embedFont(StandardFonts.Helvetica)
page.drawText('Zeitraum 01.07.2026 bis 31.08.2026 · Seite 1', { x: 30, y: 800, size: 10, font })
const pdfBytes = await pdf.save()
assert.ok(pdfBytes.byteLength > 100)

const ExcelJS = await import('exceljs')
const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook
assert.equal(typeof Workbook, 'function')
const workbook = new Workbook()
workbook.addWorksheet('Arbeitszeiten').addRow(['Habun Security', 'Test'])
const excelBytes = await workbook.xlsx.writeBuffer()
assert.ok(excelBytes.byteLength > 100)

console.log('PDF, Excel and centralized report branding tests passed')
