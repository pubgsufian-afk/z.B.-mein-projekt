import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const appPath = 'frontend/src/App.jsx'
let app = await readFile(appPath, 'utf8')
const scheduleStart = app.indexOf('function SchedulePage({ session }) {')
const scheduleEnd = app.indexOf('\nfunction TimesPage', scheduleStart)
assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'SchedulePage wurde nicht gefunden.')
let schedule = app.slice(scheduleStart, scheduleEnd)

if (!schedule.includes('const [pdfFrom, setPdfFrom] = useState(week)')) {
  const marker = '  const [week, setWeek] = useState(mondayOf())\n'
  assert.ok(schedule.includes(marker), 'Dienstplan-Wochenzustand wurde nicht gefunden.')
  schedule = schedule.replace(marker, `${marker}  const [pdfFrom, setPdfFrom] = useState(week)\n  const [pdfTo, setPdfTo] = useState(addDays(week, 6))\n`)
}

if (!schedule.includes('setPdfFrom(week); setPdfTo(addDays(week, 6))')) {
  const marker = '  useEffect(() => { setForm((current) => current.id ? current : { ...emptyForm }) }, [emptyForm])\n'
  assert.ok(schedule.includes(marker), 'Dienstplan-Formular-Synchronisierung wurde nicht gefunden.')
  schedule = schedule.replace(marker, `${marker}  useEffect(() => { setPdfFrom(week); setPdfTo(addDays(week, 6)) }, [week])\n`)
}

if (!schedule.includes('if (pdfTo < pdfFrom)')) {
  const marker = '  async function downloadSchedulePdf() {\n'
  assert.ok(schedule.includes(marker), 'Dienstplan-PDF-Downloadfunktion wurde nicht gefunden.')
  const validation = `  async function downloadSchedulePdf() {\n    if (!pdfFrom || !pdfTo) {\n      setNotice({ tone: 'error', text: 'Bitte Von- und Bis-Datum für den PDF-Zeitraum auswählen.' })\n      return\n    }\n    if (pdfTo < pdfFrom) {\n      setNotice({ tone: 'error', text: 'Das Bis-Datum darf nicht vor dem Von-Datum liegen.' })\n      return\n    }\n`
  schedule = schedule.replace(marker, validation)
}

const oldPayload = '        body: JSON.stringify({ from: week, to: addDays(week, 6) }),'
const newPayload = '        body: JSON.stringify({ from: pdfFrom, to: pdfTo }),'
if (!schedule.includes(newPayload)) {
  assert.ok(schedule.includes(oldPayload), 'Alter Dienstplan-PDF-Zeitraum wurde nicht gefunden.')
  schedule = schedule.replace(oldPayload, newPayload)
}

if (!schedule.includes('aria-label="Dienstplan PDF von"')) {
  const pdfButton = `{MANAGEMENT.has(session.role) && <button className="secondary-button" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>{busy === 'schedule-pdf' ? 'PDF wird erstellt …' : 'Dienstplan als PDF'}</button>}`
  assert.ok(schedule.includes(pdfButton), 'Dienstplan-PDF-Schaltfläche wurde nicht gefunden.')
  const rangeFields = `{MANAGEMENT.has(session.role) && <div className="schedule-pdf-range"><label>PDF von<input aria-label="Dienstplan PDF von" type="date" value={pdfFrom} onChange={(event) => setPdfFrom(event.target.value)} /></label><label>PDF bis<input aria-label="Dienstplan PDF bis" type="date" value={pdfTo} min={pdfFrom || undefined} onChange={(event) => setPdfTo(event.target.value)} /></label></div>}${pdfButton}`
  schedule = schedule.replace(pdfButton, rangeFields)
}

app = app.slice(0, scheduleStart) + schedule + app.slice(scheduleEnd)
await writeFile(appPath, app)

const stylesPath = 'frontend/src/styles.css'
let styles = await readFile(stylesPath, 'utf8')
if (!styles.includes('/* SCHEDULE_PDF_RANGE */')) {
  styles += `\n\n/* SCHEDULE_PDF_RANGE */\n.schedule-pdf-range { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }\n.schedule-pdf-range label { display: grid; gap: 5px; min-width: 145px; color: var(--muted); font-size: 12px; font-weight: 800; }\n.schedule-pdf-range input { min-height: 40px; }\n@media (max-width: 680px) {\n  .schedule-pdf-range { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }\n  .schedule-pdf-range label { min-width: 0; }\n  .schedule-pdf-range input { width: 100%; }\n}\n@media (max-width: 390px) {\n  .schedule-pdf-range { grid-template-columns: 1fr; }\n}\n`
  await writeFile(stylesPath, styles)
}

console.log('Schedule PDF range feature applied')
