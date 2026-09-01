import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-monthly-reports.mts'
let source = await readFile(path, 'utf8')

const oldLogoHelper = `async function embedLogo(pdf: any, request: Request, logoUrl: string) {
  try {
    const response = await fetch(new URL(logoUrl || '/habun-logo.png', request.url), { cache: 'no-store' })
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    return response.headers.get('content-type')?.includes('jpeg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  } catch { return null }
}`

const exportLogoHelper = `function exportLogoUrl(logoUrl: string) {
  const resolved = text(logoUrl, 300) || '/habun-logo-pdf.png'
  return resolved === '/habun-logo.png' ? '/habun-logo-pdf.png' : resolved
}
async function loadExportLogo(request: Request, logoUrl: string) {
  try {
    const response = await fetch(new URL(exportLogoUrl(logoUrl), request.url), { cache: 'no-store' })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    const extension = response.headers.get('content-type')?.includes('jpeg') ? 'jpeg' : 'png'
    return { bytes, extension } as const
  } catch { return null }
}
async function embedLogo(pdf: any, request: Request, logoUrl: string) {
  const asset = await loadExportLogo(request, logoUrl)
  if (!asset) return null
  return asset.extension === 'jpeg' ? await pdf.embedJpg(asset.bytes) : await pdf.embedPng(asset.bytes)
}`

if (!source.includes('function exportLogoUrl(logoUrl: string)')) {
  assert.ok(source.includes(oldLogoHelper), 'Logo-Helfer im Stundenzettel-Export wurde nicht gefunden.')
  source = source.replace(oldLogoHelper, exportLogoHelper)
}

const oldWatermark = `    const drawWatermark = () => {
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

const cleanLogoBlock = `    const drawWatermark = () => {
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

if (!source.includes('const scale = Math.min(88 / logo.width, 88 / logo.height)')) {
  assert.ok(source.includes(oldWatermark), 'PDF-Logo-Block wurde nicht gefunden.')
  source = source.replace(oldWatermark, cleanLogoBlock)
}

const pdfLikeBuildXlsx = `async function buildXlsx(request: Request, rows: DailyTimesheetRow[], from: string, to: string) {
  const ExcelJSModule = await import('exceljs')
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule
  const workbook = new ExcelJS.Workbook()
  const settings = await readCompanySettings()
  const logoAsset = await loadExportLogo(request, settings.logoUrl)
  const logoImageId = logoAsset
    ? workbook.addImage({ buffer: Buffer.from(logoAsset.bytes), extension: logoAsset.extension })
    : null

  workbook.creator = settings.companyName
  workbook.company = settings.companyName
  workbook.subject = 'Stundenzettel'
  workbook.title = 'Stundenzettel'
  workbook.created = new Date()
  workbook.modified = new Date()

  const used = new Set<string>()
  const groups = groupRows(rows)
  const colors = {
    dark: 'FF151515',
    green: 'FF7EAB4F',
    orange: 'FFE8843D',
    weekend: 'FFE3E3E3',
    white: 'FFFFFFFF',
    line: 'FF777777',
    muted: 'FF666666',
  }
  const thinBorder = {
    top: { style: 'thin', color: { argb: colors.line } },
    left: { style: 'thin', color: { argb: colors.line } },
    bottom: { style: 'thin', color: { argb: colors.line } },
    right: { style: 'thin', color: { argb: colors.line } },
  }
  const headers = ['Datum', 'Startzeit', 'Endzeit', 'Pause', 'Arbeitsstunden', 'Urlaub / Krank / unbezahlter Urlaub / Feiertag']

  for (const employeeRows of groups.length ? groups : [[] as DailyTimesheetRow[]]) {
    const employeeName = employeeRows[0]?.employeeName || 'Keine Einträge'
    const displayRows = rowsWithBlankDates(employeeRows, from, to)
    const sheet = workbook.addWorksheet(safeSheetName(employeeName, used), {
      properties: { defaultRowHeight: 15, tabColor: { argb: colors.green } },
      views: [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7', showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        horizontalCentered: true,
        verticalCentered: false,
        margins: { left: 0.25, right: 0.25, top: 0.25, bottom: 0.35, header: 0.1, footer: 0.2 },
      },
    })

    sheet.columns = [
      { key: 'date', width: 15 },
      { key: 'start', width: 14 },
      { key: 'end', width: 14 },
      { key: 'pause', width: 15 },
      { key: 'duration', width: 18 },
      { key: 'absence', width: 24 },
    ]

    sheet.mergeCells('A1:F1')
    sheet.getCell('A1').value = 'Stundenzettel'
    sheet.getCell('A1').font = { name: 'Aptos', size: 15, bold: true, color: { argb: colors.dark } }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell('A1').border = thinBorder
    sheet.getRow(1).height = 28

    sheet.mergeCells('A2:F2')
    sheet.getCell('A2').value = monthLabel(from, to)
    sheet.getCell('A2').font = { name: 'Aptos', size: 10, bold: true, color: { argb: colors.dark } }
    sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell('A2').border = { left: thinBorder.left, right: thinBorder.right }
    sheet.getRow(2).height = 18

    sheet.mergeCells('A3:F3')
    sheet.getCell('A3').value = \`Arbeitnehmer: \${employeeName}\`
    sheet.getCell('A3').font = { name: 'Aptos', size: 9.5, bold: true, color: { argb: colors.dark } }
    sheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' }
    sheet.getCell('A3').border = { left: thinBorder.left, right: thinBorder.right, bottom: thinBorder.bottom }
    sheet.getRow(3).height = 20

    sheet.getRow(4).height = 12
    sheet.getRow(5).height = 8

    const headerRow = sheet.getRow(6)
    headerRow.values = headers
    headerRow.height = 20
    headerRow.eachCell((cell: any) => {
      cell.font = { name: 'Aptos', size: 7.5, bold: true, color: { argb: colors.dark } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.green } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })

    for (const item of displayRows) {
      const row = item.row
      const excelRow = sheet.addRow([
        shortGermanDate(item.date),
        row?.start || '',
        row?.end || '',
        row ? pauseDisplay(row.pauseMinutes) : '',
        row ? durationText(row.netMinutes) : '',
        '',
      ])
      excelRow.height = 16
      excelRow.eachCell((cell: any) => {
        cell.font = { name: 'Aptos', size: 7.5, color: { argb: colors.dark } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekend(item.date) ? colors.weekend : colors.white } }
        cell.border = thinBorder
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
    }

    const total = employeeRows.reduce((sum, row) => sum + Math.max(0, Number(row.netMinutes) || 0), 0)
    const totalRowNumber = sheet.rowCount + 2
    sheet.mergeCells(\`A\${totalRowNumber}:D\${totalRowNumber}\`)
    const totalLabel = sheet.getCell(\`A\${totalRowNumber}\`)
    totalLabel.value = 'Gesamtdauer'
    totalLabel.font = { name: 'Aptos', size: 9, bold: true, color: { argb: colors.dark } }
    totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.orange } }
    totalLabel.border = thinBorder
    totalLabel.alignment = { horizontal: 'left', vertical: 'middle' }
    const totalValue = sheet.getCell(\`E\${totalRowNumber}\`)
    totalValue.value = \`\${durationText(total)} Std.\`
    totalValue.font = { name: 'Aptos', size: 9, bold: true, color: { argb: colors.dark } }
    totalValue.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.orange } }
    totalValue.border = thinBorder
    totalValue.alignment = { horizontal: 'left', vertical: 'middle' }
    sheet.getRow(totalRowNumber).height = 23

    const notesStart = totalRowNumber + 2
    const notesEnd = notesStart + 4
    sheet.mergeCells(\`A\${notesStart}:F\${notesEnd}\`)
    const notes = sheet.getCell(\`A\${notesStart}\`)
    notes.value = 'Platz für weitere Anmerkungen...'
    notes.font = { name: 'Aptos', size: 8, color: { argb: colors.dark } }
    notes.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
    notes.border = thinBorder
    for (let rowNumber = notesStart; rowNumber <= notesEnd; rowNumber += 1) sheet.getRow(rowNumber).height = 16

    if (logoImageId !== null) {
      sheet.addImage(logoImageId, {
        tl: { col: 1.55, row: notesEnd + 1.1 },
        ext: { width: 82, height: 82 },
        editAs: 'oneCell',
      })
    }

    const footerText = [settings.companyName, settings.address, settings.phone, settings.email].filter(Boolean).join(' · ')
    sheet.headerFooter.oddFooter = \`&L&8\${text(footerText, 150)}&R&8Seite &P von &N\`
    sheet.headerFooter.evenFooter = sheet.headerFooter.oddFooter
    const printEnd = notesEnd + 8
    sheet.pageSetup.printArea = \`A1:F\${printEnd}\`
    sheet.pageSetup.printTitlesRow = '1:6'
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer())
}`

const buildXlsxPattern = /async function buildXlsx\((?:request: Request, )?rows: DailyTimesheetRow\[\], from: string, to: string\) \{[\s\S]*?\n\}\n(?=export default async function timesheetMonthlyReports)/
assert.match(source, buildXlsxPattern, 'Excel-Exportfunktion wurde nicht gefunden.')
source = source.replace(buildXlsxPattern, `${pdfLikeBuildXlsx}\n`)
source = source.replace("const bytes = format === 'pdf' ? await buildPdf(request, rows, from, to) : await buildXlsx(rows, from, to)", "const bytes = format === 'pdf' ? await buildPdf(request, rows, from, to) : await buildXlsx(request, rows, from, to)")

await writeFile(path, source)
console.log('PDF-Logo bereinigt und Excel an das PDF-Stundenzettel-Layout angeglichen')
