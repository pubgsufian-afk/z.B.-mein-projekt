import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const reportPath = 'netlify/functions/unified-reports-fixed.mts'
let report = await readFile(reportPath, 'utf8')

if (!report.includes("import { EXPORT_LOGO_PNG_BASE64 } from './_shared/export-logo.mts'")) {
  const marker = "import { readCompanySettings } from './_shared/company-settings.mts'\n"
  assert.ok(report.includes(marker), 'Firmen-Einstellungen-Import fehlt.')
  report = report.replace(marker, `${marker}import { EXPORT_LOGO_PNG_BASE64 } from './_shared/export-logo.mts'\n`)
}

if (!report.includes('async function loadExcelLogoBytes()')) {
  const marker = '\nasync function buildExcel(rows: ReportRow[], from: string, to: string) {'
  assert.ok(report.includes(marker), 'Excel-Builder-Marker fehlt.')
  const helper = `\nasync function loadExcelLogoBytes() {\n  try {\n    return Buffer.from(EXPORT_LOGO_PNG_BASE64, 'base64')\n  } catch {\n    return null\n  }\n}\n\nasync function buildExcel(request: Request, rows: ReportRow[], from: string, to: string) {`
  report = report.replace(marker, helper)
}

if (!report.includes('const logoBytes = await loadExcelLogoBytes()')) {
  const marker = "  workbook.created = new Date()\n  const sheet = workbook.addWorksheet('Arbeitszeiten', { views: [{ state: 'frozen', ySplit: 6 }] })\n"
  assert.ok(report.includes(marker), 'Excel-Arbeitsblatt-Marker fehlt.')
  const replacement = `  workbook.created = new Date()\n  const logoBytes = await loadExcelLogoBytes()\n  const logoId = logoBytes ? workbook.addImage({ buffer: logoBytes, extension: 'png' }) : null\n  const sheet = workbook.addWorksheet('Arbeitszeiten', { views: [{ state: 'frozen', ySplit: 9 }] })\n  sheet.mergeCells('A1:J5')\n  if (logoId !== null) sheet.addImage(logoId, { tl: { col: 4.35, row: 0.15 }, ext: { width: 92, height: 100 } })\n`
  report = report.replace(marker, replacement)
}

if (!report.includes("sheet.addRow([clean(settings.companyName) || 'Habun Security']).font = { bold: true, size: 14 }")) {
  report = report.replace(
    "  sheet.addRow([clean(settings.companyName) || 'Habun Security'])\n  sheet.addRow([clean(settings.phone), clean(settings.email)])\n  sheet.addRow([`Zeitraum ${from} bis ${to}`])\n  sheet.addRow([])\n  sheet.addRow(['Mitarbeiter', 'Datum', 'Plan Beginn', 'Plan Ende', 'Ist Beginn', 'Ist Ende', 'Pause Min.', 'Netto Std.', 'Einsatzort', 'Hinweis']).font = { bold: true }",
    "  sheet.addRow([clean(settings.companyName) || 'Habun Security']).font = { bold: true, size: 14 }\n  sheet.addRow([clean(settings.phone), clean(settings.email), clean(settings.address)])\n  sheet.addRow([`Zeitraum ${from} bis ${to}`])\n  sheet.addRow(['Mitarbeiter', 'Datum', 'Plan Beginn', 'Plan Ende', 'Ist Beginn', 'Ist Ende', 'Pause Min.', 'Netto Std.', 'Einsatzort', 'Hinweis']).font = { bold: true }",
  )
}

if (!report.includes("sumSheet.mergeCells('A1:B5')")) {
  const marker = "  const sumSheet = workbook.addWorksheet('Summen')\n"
  assert.ok(report.includes(marker), 'Excel-Summenblatt-Marker fehlt.')
  report = report.replace(marker, `${marker}  sumSheet.mergeCells('A1:B5')\n  if (logoId !== null) sumSheet.addImage(logoId, { tl: { col: 0.68, row: 0.15 }, ext: { width: 92, height: 100 } })\n`)
  report = report.replace(
    "  sumSheet.addRow([clean(settings.companyName) || 'Habun Security', 'Stundensummen'])\n  sumSheet.addRow([`Zeitraum ${from} bis ${to}`])\n  sumSheet.addRow([])\n  sumSheet.addRow(['Mitarbeiter', 'Stunden']).font = { bold: true }",
    "  sumSheet.addRow([clean(settings.companyName) || 'Habun Security', 'Stundensummen']).font = { bold: true, size: 14 }\n  sumSheet.addRow([clean(settings.phone), clean(settings.email)])\n  sumSheet.addRow([clean(settings.address), `Zeitraum ${from} bis ${to}`])\n  sumSheet.addRow(['Mitarbeiter', 'Stunden']).font = { bold: true }",
  )
}

report = report.replace('      const bytes = await buildExcel(rows, from, to)', '      const bytes = await buildExcel(request, rows, from, to)')
await writeFile(reportPath, report)

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
app = app.replace('objects.find((item) => item.id === objectId)', 'objects.find((item) => String(item.id) === String(objectId))')

if (!app.includes('Dienstplan-PDF herunterladen')) {
  const oldRange = '<div className="schedule-pdf-range"><label>PDF von<input aria-label="Dienstplan PDF von" type="date" value={pdfFrom} onChange={(event) => setPdfFrom(event.target.value)} /></label><label>PDF bis<input aria-label="Dienstplan PDF bis" type="date" value={pdfTo} min={pdfFrom || undefined} onChange={(event) => setPdfTo(event.target.value)} /></label></div>'
  const newRange = '<div className="schedule-pdf-range"><div className="schedule-pdf-range-head"><strong>Dienstplan-PDF herunterladen</strong><span>PDF-Zeitraum frei auswählen</span></div><label>Von<input aria-label="Dienstplan PDF von" type="date" value={pdfFrom} onChange={(event) => setPdfFrom(event.target.value)} /></label><label>Bis<input aria-label="Dienstplan PDF bis" type="date" value={pdfTo} min={pdfFrom || undefined} onChange={(event) => setPdfTo(event.target.value)} /></label></div>'
  assert.ok(app.includes(oldRange), 'Dienstplan-PDF-Zeitraum wurde nicht gefunden.')
  app = app.replace(oldRange, newRange)
}
await writeFile(appPath, app)

const stylesPath = 'frontend/src/styles.css'
let styles = await readFile(stylesPath, 'utf8')
if (!styles.includes('/* FINAL_SCHEDULE_PDF_CLARITY */')) {
  styles += `\n\n/* FINAL_SCHEDULE_PDF_CLARITY */\n.schedule-pdf-range { flex: 1 0 100%; width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: #111719; }\n.schedule-pdf-range-head { flex: 1 0 100%; display: grid; gap: 2px; width: 100%; margin-bottom: 2px; }\n.schedule-pdf-range-head strong { color: var(--text); font-size: 14px; }\n.schedule-pdf-range-head span { color: var(--muted); font-size: 12px; }\n@media (max-width: 680px) { .schedule-pdf-range-head { grid-column: 1 / -1; } }\n`
  await writeFile(stylesPath, styles)
}

console.log('Final production export and schedule fixes applied')
