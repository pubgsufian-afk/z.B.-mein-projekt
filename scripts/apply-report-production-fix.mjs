import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'

const mode = process.argv[2]
if (!['tests', 'fix', 'cleanup'].includes(mode)) throw new Error('Use tests, fix or cleanup')

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Missing ${label}`)
  return source.replace(needle, replacement)
}

function replaceSection(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`Missing section ${label}`)
  return source.slice(0, start) + replacement + source.slice(end)
}

const regressionTest = String.raw`import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [unified, legacy, schedule, app, styles, reportEvents, pdfLogo] = await Promise.all([
  readFile('netlify/functions/unified-reports.mts', 'utf8'),
  readFile('netlify/functions/reports-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-pdf.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
  readFile('netlify/functions/_shared/report-events.mts', 'utf8').catch(() => ''),
  readFile('netlify/functions/_shared/pdf-logo.mts', 'utf8').catch(() => ''),
])

assert.match(reportEvents, /getDatabase/)
assert.match(reportEvents, /db\.pool\.query/)
assert.doesNotMatch(unified + legacy, /@neondatabase\/serverless|databaseConnectionString/)
assert.match(unified, /loadReportEvents/)
assert.match(legacy, /loadReportEvents/)
assert.match(unified + legacy + schedule, /drawCenteredShieldLogo/)
assert.match(pdfLogo, /clip\(\)/)
assert.match(pdfLogo, /pageWidth \/ 2/)
assert.doesNotMatch(app, /<select multiple value=\{selected\}/)
assert.match(app, /employee-filter-options/)
assert.match(styles, /\.employee-filter-options/)

const { buildReportEventQuery } = await import('../netlify/functions/_shared/report-events.mts')
const all = buildReportEventQuery('2026-07-01', '2026-07-31', [])
assert.equal(all.params.length, 2)
assert.doesNotMatch(all.text, /IN \(/)
const selected = buildReportEventQuery('2026-07-01', '2026-07-31', ['u1', 'u2'])
assert.deepEqual(selected.params, ['2026-07-01', '2026-07-31', 'u1', 'u2'])
assert.match(selected.text, /user_id IN \(\$3, \$4\)/)

const { shieldLogoPlacement } = await import('../netlify/functions/_shared/pdf-logo.mts')
const placement = shieldLogoPlacement({ width: 603, height: 203 }, 842, 559, 76)
assert.ok(Math.abs(placement.centerX - 421) < 0.01)
assert.ok(placement.scale > 0)
assert.ok(placement.imageX < placement.centerX)
console.log('Production report database, filter and PDF logo tests passed')
`

const reportEventsSource = String.raw`import { getDatabase } from '@netlify/database'

export type ReportEventRow = {
  id: string
  user_id: string
  schedule_id: string | null
  action: 'clock-in' | 'break-start' | 'break-end' | 'clock-out'
  client_occurred_at: string | Date
  event_date: string | Date
  object_id: string | null
  location_status: string
  offline_captured: boolean
}

export function buildReportEmployeeFilter(userIds: string[]) {
  if (!userIds.length) return { clause: '', params: [] as string[] }
  const placeholders = userIds.map((_, index) => '$' + (index + 3)).join(', ')
  return { clause: ' AND user_id IN (' + placeholders + ')', params: userIds }
}

export function buildReportEventQuery(from: string, to: string, userIds: string[]) {
  const employeeFilter = buildReportEmployeeFilter(userIds)
  return {
    text: 'SELECT id, user_id, schedule_id, action, client_occurred_at, event_date, object_id, location_status, offline_captured FROM attendance_events WHERE event_date BETWEEN $1::date AND $2::date' + employeeFilter.clause + ' ORDER BY user_id, event_date, client_occurred_at',
    params: [from, to, ...employeeFilter.params],
  }
}

export async function loadReportEvents(from: string, to: string, userIds: string[]) {
  const db = getDatabase()
  const query = buildReportEventQuery(from, to, userIds)
  const result = await db.pool.query(query.text, query.params)
  return result.rows as ReportEventRow[]
}
`

const pdfLogoSource = String.raw`import type { PDFImage, PDFPage } from 'pdf-lib'
import { clip, closePath, endPath, lineTo, moveTo, popGraphicsState, pushGraphicsState } from 'pdf-lib'

const SOURCE_WIDTH = 603
const SOURCE_HEIGHT = 203
const SHIELD_LEFT = 237
const SHIELD_TOP = 39
const SHIELD_WIDTH = 129
const SHIELD_HEIGHT = 132

export function shieldLogoPlacement(logo: Pick<PDFImage, 'width' | 'height'>, pageWidth: number, topY: number, targetWidth = 76) {
  const sourceScale = targetWidth / SHIELD_WIDTH
  const centerX = pageWidth / 2
  const shieldHeight = SHIELD_HEIGHT * sourceScale
  const shieldLeft = centerX - targetWidth / 2
  const shieldBottom = topY - shieldHeight
  return {
    centerX,
    sourceScale,
    scale: sourceScale,
    imageX: shieldLeft - SHIELD_LEFT * sourceScale,
    imageY: shieldBottom - (SOURCE_HEIGHT - SHIELD_TOP - SHIELD_HEIGHT) * sourceScale,
    imageWidth: logo.width * sourceScale,
    imageHeight: logo.height * sourceScale,
    shieldLeft,
    shieldBottom,
    shieldWidth: targetWidth,
    shieldHeight,
  }
}

export function drawCenteredShieldLogo(page: PDFPage, logo: PDFImage | null, pageWidth: number, topY: number, targetWidth = 76) {
  if (!logo) return null
  const p = shieldLogoPlacement(logo, pageWidth, topY, targetWidth)
  const x0 = p.shieldLeft
  const x1 = p.shieldLeft + p.shieldWidth
  const y0 = p.shieldBottom
  const y1 = p.shieldBottom + p.shieldHeight
  const cx = p.centerX
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x0 + p.shieldWidth * 0.08, y1),
    lineTo(x1 - p.shieldWidth * 0.08, y1),
    lineTo(x1 - p.shieldWidth * 0.12, y0 + p.shieldHeight * 0.47),
    lineTo(cx + p.shieldWidth * 0.20, y0 + p.shieldHeight * 0.20),
    lineTo(cx, y0),
    lineTo(cx - p.shieldWidth * 0.20, y0 + p.shieldHeight * 0.20),
    lineTo(x0 + p.shieldWidth * 0.12, y0 + p.shieldHeight * 0.47),
    closePath(),
    clip(),
    endPath(),
  )
  page.drawImage(logo, { x: p.imageX, y: p.imageY, width: p.imageWidth, height: p.imageHeight })
  page.pushOperators(popGraphicsState())
  return p
}

export function centeredTextX(font: { widthOfTextAtSize(text: string, size: number): number }, text: string, size: number, pageWidth: number) {
  return Math.max(24, (pageWidth - font.widthOfTextAtSize(text, size)) / 2)
}

export async function embedPdfLogo(pdf: { embedPng(bytes: ArrayBuffer): Promise<PDFImage>; embedJpg(bytes: ArrayBuffer): Promise<PDFImage> }, request: Request, configuredLogoUrl = '') {
  const logoUrl = String(configuredLogoUrl || '/habun-logo.png').trim() || '/habun-logo.png'
  try {
    const response = await fetch(new URL(logoUrl, request.url), { cache: 'no-store' })
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    const type = String(response.headers.get('content-type') || '').toLowerCase()
    return type.includes('jpeg') || type.includes('jpg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
  } catch {
    return null
  }
}
`

async function writeTests() {
  await mkdir('scripts', { recursive: true })
  await writeFile('scripts/report-production-regression-test.mjs', regressionTest)
}

async function applyFix() {
  await mkdir('netlify/functions/_shared', { recursive: true })
  await writeFile('netlify/functions/_shared/report-events.mts', reportEventsSource)
  await writeFile('netlify/functions/_shared/pdf-logo.mts', pdfLogoSource)

  let unified = await readFile('netlify/functions/unified-reports.mts', 'utf8')
  unified = replaceRequired(unified, "import { databaseConnectionString } from './_shared/database-connection.mts'", "import { buildReportEmployeeFilter, loadReportEvents } from './_shared/report-events.mts'\nimport { centeredTextX, drawCenteredShieldLogo, embedPdfLogo } from './_shared/pdf-logo.mts'", 'unified imports')
  unified = replaceSection(unified, 'export function buildEmployeeFilter(userIds: string[]) {', '\n\nasync function fetchJson', "export function buildEmployeeFilter(userIds: string[]) {\n  return buildReportEmployeeFilter(userIds)\n}", 'unified employee filter')
  unified = replaceSection(unified, '  const connection = databaseConnectionString()', '  const [schedules, names] = await Promise.all', "  let events: EventRow[]\n  try {\n    events = await loadReportEvents(from, to, userIds) as EventRow[]\n  } catch (error) {\n    console.error('Habun report query', error)\n    return json({ message: 'Die Arbeitszeitdaten konnten nicht geladen werden.', code: 'REPORT_QUERY_FAILED' }, 500)\n  }\n\n", 'unified query')
  unified = replaceSection(unified, '  let logo: any = null', '\n\n  const pageWidth = 842', "  const logo = await embedPdfLogo(pdf, request, settings.logoUrl)\n", 'unified logo load')
  unified = replaceSection(unified, "    if (logo) {\n      const scale = Math.min(86 / logo.width, 64 / logo.height)", "    page.drawText('Stundenbericht'", "    drawCenteredShieldLogo(page, logo, pageWidth, y + 4, 76)\n    const companyName = text(settings.companyName) || 'Habun Security'\n    page.drawText(companyName, { x: centeredTextX(bold, companyName, 17, pageWidth), y: y - 82, size: 17, font: bold, color: rgb(.08, .08, .08) })\n    const phone = text(settings.phone || 'Telefon nicht hinterlegt')\n    const email = text(settings.email || 'E-Mail nicht hinterlegt')\n    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, pageWidth), y: y - 98, size: 8.5, font: regular, color: rgb(.2, .2, .2) })\n    page.drawText(email, { x: centeredTextX(regular, email, 8.5, pageWidth), y: y - 111, size: 8.5, font: regular, color: rgb(.2, .2, .2) })\n    page.drawText('Stundenbericht'", 'unified centered header')
  unified = replaceRequired(unified, "{ x: margin, y: y - 66, size: 15, font: bold }", "{ x: margin, y: y - 138, size: 15, font: bold }", 'unified title position')
  unified = replaceRequired(unified, "{ x: margin, y: y - 82, size: 8.5, font: regular }", "{ x: margin, y: y - 154, size: 8.5, font: regular }", 'unified period position')
  unified = replaceRequired(unified, '    y -= 110', '    y -= 182', 'unified header height')
  await writeFile('netlify/functions/unified-reports.mts', unified)

  let legacy = await readFile('netlify/functions/reports-v2.mts', 'utf8')
  legacy = replaceRequired(legacy, "import { databaseConnectionString } from './_shared/database-connection.mts'", "import { buildReportEmployeeFilter, loadReportEvents } from './_shared/report-events.mts'\nimport { centeredTextX, drawCenteredShieldLogo, embedPdfLogo } from './_shared/pdf-logo.mts'", 'legacy imports')
  legacy = replaceSection(legacy, 'export function buildEmployeeFilter(userIds: string[]) {', '\n\nfunction safeText', "export function buildEmployeeFilter(userIds: string[]) {\n  return buildReportEmployeeFilter(userIds)\n}", 'legacy employee filter')
  legacy = replaceSection(legacy, '  const url = databaseConnectionString()', '  const schedules = await fetchSchedules', "  let events: Record<string, unknown>[]\n  try {\n    events = await loadReportEvents(from, to, userIds) as Record<string, unknown>[]\n  } catch (error) {\n    console.error('Habun legacy report query', error)\n    return json({ message: 'Die Arbeitszeitdaten konnten nicht geladen werden.', code: 'REPORT_QUERY_FAILED' }, 500)\n  }\n\n", 'legacy query')
  legacy = replaceSection(legacy, '  let logo: any = null', '\n  const company =', "  const logo = await embedPdfLogo(pdf, request, '/habun-logo.png')\n", 'legacy logo load')
  legacy = replaceSection(legacy, "    if (logo) {\n      const scaled = logo.scale(0.11)", "    page.drawText(reportType", "    drawCenteredShieldLogo(page, logo, width, y + 4, 74)\n    page.drawText(company, { x: centeredTextX(bold, company, 16, width), y: y - 80, size: 16, font: bold })\n    if (contact) page.drawText(contact, { x: centeredTextX(regular, contact, 8, width), y: y - 96, size: 8, font: regular })\n    page.drawText(reportType", 'legacy centered header')
  legacy = replaceRequired(legacy, "{ x: margin, y: y - 50, size: 14, font: bold }", "{ x: margin, y: y - 122, size: 14, font: bold }", 'legacy title position')
  legacy = replaceRequired(legacy, "{ x: margin, y: y - 67, size: 9, font: regular }", "{ x: margin, y: y - 139, size: 9, font: regular }", 'legacy period position')
  legacy = replaceRequired(legacy, '    y -= 95', '    y -= 167', 'legacy header height')
  await writeFile('netlify/functions/reports-v2.mts', legacy)

  let schedule = await readFile('netlify/functions/schedule-pdf.mts', 'utf8')
  schedule = replaceRequired(schedule, "import { readCompanySettings } from './_shared/company-settings.mts'", "import { readCompanySettings } from './_shared/company-settings.mts'\nimport { centeredTextX, drawCenteredShieldLogo, embedPdfLogo } from './_shared/pdf-logo.mts'", 'schedule import')
  schedule = replaceSection(schedule, 'async function embedLogo(', '\n\nasync function buildSchedulePdf', '', 'old schedule embed logo')
  schedule = replaceRequired(schedule, '  const logo = await embedLogo(pdf, request, settings.logoUrl)', '  const logo = await embedPdfLogo(pdf, request, settings.logoUrl)', 'schedule logo helper')
  schedule = replaceSection(schedule, "    if (logo) {\n      const scale = Math.min(74 / logo.width, 58 / logo.height)", "    page.drawText('Dienstplan'", "    drawCenteredShieldLogo(page, logo, width, y + 4, 72)\n    const companyName = safePdfText(settings.companyName, 60)\n    page.drawText(companyName, { x: centeredTextX(bold, companyName, 16, width), y: y - 78, size: 16, font: bold })\n    const phone = safePdfText(settings.phone || 'Telefon nicht hinterlegt', 70)\n    const email = safePdfText(settings.email || 'E-Mail nicht hinterlegt', 90)\n    page.drawText(phone, { x: centeredTextX(regular, phone, 8.5, width), y: y - 94, size: 8.5, font: regular })\n    page.drawText(email, { x: centeredTextX(regular, email, 8.5, width), y: y - 107, size: 8.5, font: regular })\n    page.drawText('Dienstplan'", 'schedule centered header')
  schedule = replaceRequired(schedule, "{ x: margin, y: y - 65, size: 15, font: bold }", "{ x: margin, y: y - 132, size: 15, font: bold }", 'schedule title position')
  schedule = replaceRequired(schedule, "{ x: margin, y: y - 81, size: 8.5, font: regular }", "{ x: margin, y: y - 148, size: 8.5, font: regular }", 'schedule period position')
  schedule = replaceRequired(schedule, '    y -= 108', '    y -= 176', 'schedule header height')
  await writeFile('netlify/functions/schedule-pdf.mts', schedule)

  let app = await readFile('frontend/src/App.jsx', 'utf8')
  app = replaceRequired(app, "  const payload = { from, to, userIds: selected, reportType: selected.length === 1 ? 'employee' : 'combined' }", "  const payload = { from, to, userIds: selected, reportType: selected.length === 1 ? 'employee' : 'combined' }\n  const toggleEmployee = (userId) => setSelected((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId])", 'report toggle')
  const oldFilter = '<label>Mitarbeiter<select multiple value={selected} onChange={(event) => setSelected([...event.target.selectedOptions].map((option) => option.value))}>{employees.map((employee) => <option key={employee.userId || employee.id} value={employee.userId || employee.id}>{employee.fullName}</option>)}</select><small>Keine Auswahl bedeutet Gesamtübersicht.</small></label>'
  const newFilter = '<fieldset className="employee-filter-field"><legend>Mitarbeiter</legend><div className="employee-filter-summary">{selected.length ? `${selected.length} Mitarbeiter ausgewählt` : \'Alle Mitarbeiter\'}</div><div className="employee-filter-options">{employees.length ? employees.map((employee) => { const userId = String(employee.userId || employee.id); return <label key={userId}><input type="checkbox" checked={selected.includes(userId)} onChange={() => toggleEmployee(userId)} /><span>{employee.fullName}</span></label> }) : <span className="muted">Keine Mitarbeiter verfügbar.</span>}</div><small>Keine Auswahl bedeutet Gesamtübersicht.</small></fieldset>'
  app = replaceRequired(app, oldFilter, newFilter, 'mobile employee filter')
  await writeFile('frontend/src/App.jsx', app)

  let styles = await readFile('frontend/src/styles.css', 'utf8')
  if (!styles.includes('.employee-filter-field')) styles += String.raw`

.employee-filter-field { min-width: 0; margin: 0; padding: 0; border: 0; }
.employee-filter-field legend { margin-bottom: .55rem; font-weight: 800; }
.employee-filter-summary { display: flex; align-items: center; min-height: 3.35rem; padding: .8rem 1rem; border: 1px solid var(--line); border-radius: 1rem; background: rgba(255,255,255,.025); font-weight: 800; }
.employee-filter-options { display: grid; gap: .45rem; max-height: 12rem; margin-top: .55rem; padding: .55rem; overflow-y: auto; border: 1px solid var(--line); border-radius: 1rem; background: rgba(0,0,0,.16); }
.employee-filter-options label { display: flex; align-items: center; gap: .7rem; min-height: 2.75rem; padding: .55rem .7rem; border-radius: .75rem; background: rgba(255,255,255,.025); cursor: pointer; }
.employee-filter-options input { width: 1.15rem; height: 1.15rem; accent-color: var(--gold); }
.employee-filter-options span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 720px) { .employee-filter-options { max-height: 10rem; } }
`
  await writeFile('frontend/src/styles.css', styles)

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  if (!packageJson.scripts['verify:unified'].includes('report-production-regression-test.mjs')) packageJson.scripts['verify:unified'] += ' && node scripts/report-production-regression-test.mjs'
  await writeFile('package.json', JSON.stringify(packageJson, null, 2) + '\n')

  let branding = await readFile('scripts/pdf-branding-test.mjs', 'utf8')
  branding = branding.replace("const [source, legacySource] = await Promise.all([\n  readFile('netlify/functions/unified-reports.mts', 'utf8'),\n  readFile('netlify/functions/reports-v2.mts', 'utf8'),\n])", "const [source, legacySource, reportEvents, logoHelper] = await Promise.all([\n  readFile('netlify/functions/unified-reports.mts', 'utf8'),\n  readFile('netlify/functions/reports-v2.mts', 'utf8'),\n  readFile('netlify/functions/_shared/report-events.mts', 'utf8'),\n  readFile('netlify/functions/_shared/pdf-logo.mts', 'utf8'),\n])")
  branding = replaceSection(branding, 'for (const reportSource of [source, legacySource]) {', '\n\nassert.match(source, /readCompanySettings/)', "for (const reportSource of [source, legacySource]) {\n  assert.doesNotMatch(reportSource, /@neondatabase\\/serverless|databaseConnectionString/)\n  assert.match(reportSource, /loadReportEvents/)\n  assert.match(reportSource, /buildEmployeeFilter/)\n}\nassert.match(reportEvents, /getDatabase/)\nassert.match(reportEvents, /db\\.pool\\.query/)\nassert.match(reportEvents, /user_id IN \\(/)\nassert.match(logoHelper, /drawCenteredShieldLogo/)\nassert.match(logoHelper, /clip\\(\\)/)", 'branding query assertions')
  branding = branding.replace("assert.match(source, /settings\\.logoUrl/)\n", "assert.match(source, /settings\\.logoUrl/)\nassert.match(source, /embedPdfLogo/)\n")
  await writeFile('scripts/pdf-branding-test.mjs', branding)
}

if (mode === 'tests') await writeTests()
if (mode === 'fix') await applyFix()
if (mode === 'cleanup') {
  await rm('scripts/apply-report-production-fix.mjs', { force: true })
  await rm('.github/workflows/apply-report-production-fix.yml', { force: true })
}
