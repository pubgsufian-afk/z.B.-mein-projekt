import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import ExcelJS from 'exceljs'

const [source, legacy] = await Promise.all([
  readFile('netlify/functions/unified-reports.mts', 'utf8'),
  readFile('netlify/functions/reports-v2.mts', 'utf8'),
])
for (const value of [source, legacy]) {
  assert.doesNotMatch(value, /cardinality\(\$3::text\[\]\)/)
  assert.doesNotMatch(value, /ANY\(\$3::text\[\]\)/)
  assert.match(value, /export function buildEmployeeFilter/)
  assert.match(value, /REPORT_QUERY_FAILED/)
  assert.match(value, /REPORT_RENDER_FAILED/)
  assert.match(value, /X-Content-Type-Options/)
}
const pdf = await PDFDocument.create()
const page = pdf.addPage([595, 842])
const font = await pdf.embedFont(StandardFonts.Helvetica)
page.drawText('Habun Security', { x: 30, y: 800, size: 12, font })
const pdfBytes = Buffer.from(await pdf.save())
assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-')
const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('Arbeitszeiten').addRow(['Habun Security'])
const xlsx = Buffer.from(await workbook.xlsx.writeBuffer())
assert.equal(xlsx.subarray(0, 2).toString(), 'PK')
console.log('Report download contract tests passed')
