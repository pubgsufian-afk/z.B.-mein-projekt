import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const path = 'netlify/functions/timesheet-monthly-reports.mts'
let source = await readFile(path, 'utf8')

const professionalBuildXlsx = `async function buildXlsx(rows: TimesheetEntry[], from: string, to: string) {
  const ExcelJSModule = await import('exceljs')
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule
  const workbook = new ExcelJS.Workbook()
  const settings = await readCompanySettings()
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
    gold: 'FFDBA62B',
    white: 'FFFFFFFF',
    pale: 'FFF7F7F7',
    line: 'FFD0D0D0',
    muted: 'FF666666',
  }
  const thinBorder = {
    top: { style: 'thin', color: { argb: colors.line } },
    left: { style: 'thin', color: { argb: colors.line } },
    bottom: { style: 'thin', color: { argb: colors.line } },
    right: { style: 'thin', color: { argb: colors.line } },
  }

  for (const employeeRows of groups.length ? groups : [[] as TimesheetEntry[]]) {
    const employeeName = employeeRows[0]?.employeeName || 'Stundenzettel'
    const sheet = workbook.addWorksheet(safeSheetName(employeeName, used), {
      properties: { defaultRowHeight: 20, tabColor: { argb: colors.gold } },
      views: [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7' }],
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      },
    })

    sheet.columns = [
      { key: 'date', width: 15 },
      { key: 'start', width: 11 },
      { key: 'end', width: 11 },
      { key: 'pause', width: 14 },
      { key: 'duration', width: 15 },
      { key: 'status', width: 15 },
      { key: 'area', width: 25 },
      { key: 'location', width: 34 },
    ]

    sheet.mergeCells('A1:H1')
    sheet.getCell('A1').value = settings.companyName || 'Habun Security'
    sheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: colors.gold } }
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.dark } }
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(1).height = 32

    sheet.mergeCells('A2:H2')
    sheet.getCell('A2').value = 'STUNDENZETTEL'
    sheet.getCell('A2').font = { name: 'Aptos Display', size: 15, bold: true, color: { argb: colors.dark } }
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.gold } }
    sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(2).height = 26

    sheet.getCell('A3').value = 'Mitarbeiter'
    sheet.getCell('A4').value = 'Zeitraum'
    for (const labelCell of ['A3', 'A4']) {
      sheet.getCell(labelCell).font = { name: 'Aptos', bold: true, color: { argb: colors.dark } }
      sheet.getCell(labelCell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E2B7' } }
      sheet.getCell(labelCell).border = thinBorder
      sheet.getCell(labelCell).alignment = { vertical: 'middle' }
    }
    sheet.mergeCells('B3:H3')
    sheet.mergeCells('B4:H4')
    sheet.getCell('B3').value = employeeName
    sheet.getCell('B4').value = \`${germanDate(from)} - ${germanDate(to)}\`
    for (const valueCell of ['B3', 'B4']) {
      sheet.getCell(valueCell).font = { name: 'Aptos', size: 11, color: { argb: colors.dark } }
      sheet.getCell(valueCell).border = thinBorder
      sheet.getCell(valueCell).alignment = { vertical: 'middle' }
    }
    sheet.getRow(3).height = 23
    sheet.getRow(4).height = 23
    sheet.getRow(5).height = 9

    const headerRow = sheet.getRow(6)
    headerRow.values = ['Datum', 'Beginn', 'Ende', 'Pause', 'Dauer', 'Status', 'Bereich', 'Einsatzort']
    headerRow.height = 25
    headerRow.eachCell((cell: any) => {
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: colors.dark } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.gold } }
      cell.border = thinBorder
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })

    const firstDataRow = 7
    for (const row of employeeRows) {
      const excelRow = sheet.addRow([
        new Date(\`${row.workDate}T12:00:00\`),
        row.start,
        row.end,
        Math.max(0, Number(row.pauseMinutes) || 0),
        Math.max(0, Number(row.netMinutes) || 0) / 1440,
        statusText(row),
        text(row.workArea, 80),
        text(row.location, 120),
      ])
      excelRow.height = 21
      const isAlternate = (excelRow.number - firstDataRow) % 2 === 1
      excelRow.eachCell((cell: any, columnNumber: number) => {
        cell.font = { name: 'Aptos', size: 10, color: { argb: colors.dark } }
        cell.border = thinBorder
        cell.alignment = {
          horizontal: columnNumber <= 6 ? 'center' : 'left',
          vertical: 'middle',
          wrapText: columnNumber >= 7,
        }
        if (isAlternate) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } }
      })
      excelRow.getCell(1).numFmt = 'dd.mm.yyyy'
      excelRow.getCell(4).numFmt = '0 "Min."'
      excelRow.getCell(5).numFmt = '[h]:mm "Std."'
    }

    const lastDataRow = Math.max(firstDataRow, sheet.rowCount)
    sheet.autoFilter = { from: 'A6', to: \`H${lastDataRow}\` }

    const totalRowNumber = sheet.rowCount + 2
    sheet.mergeCells(\`A${totalRowNumber}:D${totalRowNumber}\`)
    sheet.mergeCells(\`E${totalRowNumber}:H${totalRowNumber}\`)
    const totalLabel = sheet.getCell(\`A${totalRowNumber}\`)
    totalLabel.value = 'Gesamtstunden'
    totalLabel.font = { name: 'Aptos', size: 11, bold: true, color: { argb: colors.dark } }
    totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.gold } }
    totalLabel.border = thinBorder
    totalLabel.alignment = { horizontal: 'left', vertical: 'middle' }

    const totalCell = sheet.getCell(\`E${totalRowNumber}\`)
    totalCell.value = employeeRows.length
      ? { formula: \`SUM(E${firstDataRow}:E${sheet.rowCount - 1})\` }
      : 0
    totalCell.numFmt = '[h]:mm "Std."'
    totalCell.font = { name: 'Aptos', size: 12, bold: true, color: { argb: colors.dark } }
    totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E2B7' } }
    totalCell.border = thinBorder
    totalCell.alignment = { horizontal: 'right', vertical: 'middle' }
    sheet.getRow(totalRowNumber).height = 27

    sheet.pageSetup.printArea = \`A1:H${totalRowNumber}\`
    sheet.pageSetup.printTitlesRow = '1:6'
    sheet.headerFooter.oddFooter = \`&L${text(settings.companyName, 60)}&CStundenzettel&RSeite &P von &N\`
    sheet.headerFooter.evenFooter = sheet.headerFooter.oddFooter

    sheet.getRange?.('A1:H1')
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}`

const buildXlsxPattern = /async function buildXlsx\(rows: TimesheetEntry\[\], from: string, to: string\) \{[\s\S]*?\n\}\n(?=export default async function timesheetMonthlyReports)/
assert.match(source, buildXlsxPattern, 'Excel-Exportfunktion wurde nicht gefunden.')
source = source.replace(buildXlsxPattern, `${professionalBuildXlsx}\n`)
await writeFile(path, source)

console.log('Professionelles Stundenzettel-Excel-Layout angewendet; PDF unverändert')
