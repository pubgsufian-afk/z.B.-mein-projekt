import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const reportPath = 'netlify/functions/unified-reports-fixed.mts'
const report = await readFile(reportPath, 'utf8')
assert.match(report, /page\.drawText\('Stundenzettel'/, 'Separater Stundenzettel-Titel fehlt.')
assert.match(report, /EXPORT_LOGO_PNG_BASE64/, 'Transparentes Excel-Logo fehlt.')
assert.match(report, /workbook\.addImage\(/, 'Excel-Stundenzettel enthält kein Firmenlogo.')
assert.match(report, /buildExcel\(request: Request,/, 'Logo-fähiger Excel-Builder fehlt.')
assert.match(report, /await buildExcel\(request, rows, from, to\)/, 'Excel-Export nutzt den Logo-fähigen Builder nicht.')
assert.match(report, /addWorksheet\('Stundenzettel'/, 'Separates Stundenzettel-Arbeitsblatt fehlt.')
assert.match(report, /addWorksheet\('Gesamtstunden'/, 'Gesamtstunden-Arbeitsblatt fehlt.')
assert.doesNotMatch(report, /'Plan Beginn'|'Plan Ende'|'Ist Beginn'|'Ist Ende'/, 'Dienstplan-Spalten dürfen nicht im Stundenzettel stehen.')

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

console.log('Final production export and schedule fixes verified')
