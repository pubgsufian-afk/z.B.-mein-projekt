# Berichte, Dienstplan-PDF und kompakter Mitarbeiter-Dienstplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF- und Excel-Berichte zuverlässig erzeugen, einen rollenbeschränkten Dienstplan-PDF-Export ergänzen und den Mitarbeiter-Dienstplan auf dem Handy nur mit tatsächlich vorhandenen freigegebenen Diensten anzeigen.

**Architecture:** Die bestehende React-Anwendung bleibt die einzige Portaloberfläche. Berichte und Dienstplan-PDFs werden serverseitig in Netlify Functions erzeugt und als validierte Binärdateien ausgeliefert. Die Management-Wochenansicht bleibt erhalten; Mitarbeiter erhalten eine separate vertikale Liste ihrer eigenen veröffentlichten Dienste.

**Tech Stack:** React 19, Netlify Functions, Netlify Identity, Neon/PostgreSQL, `pdf-lib`, `exceljs`, Node.js 22, Playwright.

## Global Constraints

- Alle Arbeiten erfolgen ausschließlich auf `fix-reports-live`.
- Kein Merge in `main`.
- Kein Netlify-Produktionsdeploy.
- `/habun-logo.png` und die bestehende Schwarz-Gold-Gestaltung bleiben unverändert.
- Mitarbeiter dürfen keine PDF- oder Excel-Datei herunterladen.
- Mitarbeiter sehen nur eigene Einträge mit `status === 'published'`.
- Tage ohne Dienst werden in der Mitarbeiteransicht nicht gerendert.
- Nur `owner`, `admin` und `manager` dürfen Dienstplan-PDFs abrufen.
- Dateiantworten verwenden `Cache-Control: no-store` und `X-Content-Type-Options: nosniff`.
- Abschluss erst nach erfolgreichem `npm run verify`, `npm run build` und `npm run test:e2e`.

---

## File Map

- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`
- Modify: `netlify/functions/unified-reports.mts`
- Modify: `netlify/functions/reports-v2.mts`
- Create: `netlify/functions/schedule-pdf.mts`
- Create: `scripts/report-download-contract-test.mjs`
- Create: `scripts/schedule-pdf-test.mjs`
- Create: `scripts/employee-schedule-compact-test.mjs`
- Modify: `scripts/unified-portal-test.mjs`
- Modify: `scripts/prepare-unified-e2e.mjs`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `package.json`
- Modify: `docs/unified-portal/verification-report-2026-08-06.md`

---

### Task 1: Berichtsabfrage und Dateierzeugung getrennt absichern

**Files:**
- Modify: `netlify/functions/unified-reports.mts`
- Modify: `netlify/functions/reports-v2.mts`
- Create: `scripts/report-download-contract-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildEmployeeFilter(userIds)`, `databaseConnectionString()`, `readCompanySettings()`.
- Produces: Fehlercodes `NO_DATA`, `REPORT_QUERY_FAILED`, `REPORT_RENDER_FAILED`; PDF `application/pdf`; XLSX `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

- [ ] **Step 1: Failing contract test schreiben**

Create `scripts/report-download-contract-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import ExcelJS from 'exceljs'

const current = await readFile('netlify/functions/unified-reports.mts', 'utf8')
const legacy = await readFile('netlify/functions/reports-v2.mts', 'utf8')

for (const source of [current, legacy]) {
  assert.doesNotMatch(source, /cardinality\(\$3::text\[\]\)/)
  assert.doesNotMatch(source, /ANY\(\$3::text\[\]\)/)
  assert.match(source, /buildEmployeeFilter/)
  assert.match(source, /REPORT_QUERY_FAILED/)
  assert.match(source, /REPORT_RENDER_FAILED/)
}

const pdf = await PDFDocument.create()
const page = pdf.addPage([595, 842])
const font = await pdf.embedFont(StandardFonts.Helvetica)
page.drawText('Habun Security', { x: 30, y: 800, size: 12, font })
const pdfBytes = Buffer.from(await pdf.save())
assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-')

const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('Arbeitszeiten').addRow(['Habun Security'])
const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer())
assert.equal(xlsxBytes.subarray(0, 2).toString(), 'PK')

console.log('Report download contract tests passed')
```

- [ ] **Step 2: Test ausführen**

```bash
node scripts/report-download-contract-test.mjs
```

Expected: FAIL, weil die beiden neuen Fehlercodes noch fehlen.

- [ ] **Step 3: Sichere Mitarbeiterfilterung exportieren**

In beiden Berichtsfunktionen:

```ts
export function buildEmployeeFilter(userIds: string[]) {
  if (!userIds.length) return { clause: '', params: [] as string[] }
  const placeholders = userIds.map((_, index) => '$' + (index + 3)).join(', ')
  return {
    clause: `\n          AND user_id IN (${placeholders})`,
    params: userIds,
  }
}
```

- [ ] **Step 4: Datenbankabfrage separat abfangen**

```ts
let events: EventRow[]
try {
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(connection)
  const employeeFilter = buildEmployeeFilter(userIds)
  events = await sql(
    `SELECT id, user_id, schedule_id, action, client_occurred_at, event_date,
            object_id, location_status, offline_captured
       FROM attendance_events
      WHERE event_date BETWEEN $1::date AND $2::date${employeeFilter.clause}
      ORDER BY user_id, event_date, client_occurred_at`,
    [from, to, ...employeeFilter.params],
  ) as EventRow[]
} catch (error) {
  console.error('Habun report query', error)
  return json({ message: 'Die Arbeitszeitdaten konnten nicht geladen werden.', code: 'REPORT_QUERY_FAILED' }, 500)
}
```

In `reports-v2.mts` wird statt `connection` die vorhandene Variable `url` verwendet.

- [ ] **Step 5: Leere Daten und Renderingfehler getrennt behandeln**

```ts
if (!rows.length) {
  return json({ message: 'Für den ausgewählten Zeitraum wurden keine Daten gefunden.', code: 'NO_DATA' }, 404)
}

try {
  if (format === 'xlsx') {
    const bytes = await buildExcel(rows, from, to)
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.xlsx"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
      },
    })
  }

  const bytes = await buildPdf(request, rows, from, to)
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
} catch (error) {
  console.error('Habun report render', error)
  return json({ message: 'Die Berichtsdatei konnte nicht erzeugt werden.', code: 'REPORT_RENDER_FAILED' }, 500)
}
```

- [ ] **Step 6: Test in `verify:unified` aufnehmen**

Append to the existing command in `package.json`:

```json
"verify:unified": "node scripts/unified-portal-test.mjs && node scripts/employee-access-policy-test.mjs && node scripts/attendance-pause-test.mjs && node scripts/company-settings-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/report-download-contract-test.mjs"
```

- [ ] **Step 7: Prüfen und committen**

```bash
npm run verify:unified
git add netlify/functions/unified-reports.mts netlify/functions/reports-v2.mts scripts/report-download-contract-test.mjs package.json
git commit -m "fix: harden report generation"
```

---

### Task 2: Dienstplan-PDF-Funktion mit Rollenprüfung erstellen

**Files:**
- Create: `netlify/functions/schedule-pdf.mts`
- Create: `scripts/schedule-pdf-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: POST `{ from: string, to: string }`, Identity-Sitzung, `/api/schedule-v2?resource=entries`.
- Produces: `POST /api/schedule-pdf`, Datei `Habun-Dienstplan-<from>-bis-<to>.pdf`, Fehlercode `NO_SCHEDULE_DATA`.

- [ ] **Step 1: Failing test schreiben**

Create `scripts/schedule-pdf-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-pdf.mts', 'utf8')
assert.match(source, /new Set<Role>\(\['owner', 'admin', 'manager'\]\)/)
assert.match(source, /Mitarbeiter dürfen keinen Dienstplan als PDF herunterladen/)
assert.match(source, /entry\.status === 'published'/)
assert.match(source, /readCompanySettings/)
assert.match(source, /NO_SCHEDULE_DATA/)
assert.match(source, /application\/pdf/)
assert.match(source, /Habun-Dienstplan-/)

console.log('Schedule PDF tests passed')
```

- [ ] **Step 2: Test ausführen**

```bash
node scripts/schedule-pdf-test.mjs
```

Expected: FAIL mit `ENOENT`.

- [ ] **Step 3: Vollständigen Endpunkt anlegen**

Create `netlify/functions/schedule-pdf.mts` with these concrete units:

```ts
import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readCompanySettings } from './_shared/company-settings.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
type AccessRecord = { role?: Role; status?: string } | null
type ScheduleEntry = {
  id: string
  employeeName: string
  date: string
  start: string
  end: string
  pauseMinutes?: number
  location?: string
  workArea?: string
  status?: string
}

const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}
```

Use the same `actor()` implementation pattern as `unified-reports.mts`: `getUser()`, `portal-access`, `PORTAL_OWNER_EMAILS`, app metadata and direct roles.

Request handling:

```ts
export default async function schedulePdf(request: Request, _context: Context) {
  const current = await actor()
  if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
  if (!MANAGEMENT.has(current.role)) {
    return json({ message: 'Mitarbeiter dürfen keinen Dienstplan als PDF herunterladen.' }, 403)
  }
  if (request.method !== 'POST') return json({ message: 'Methode nicht erlaubt.' }, 405)
  try { verifyRequestOrigin(request) } catch {
    return json({ message: 'Ungültige Anfragequelle.' }, 403)
  }

  const body = await request.json().catch(() => null) as { from?: string; to?: string } | null
  const from = String(body?.from || '')
  const to = String(body?.to || '')
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) {
    return json({ message: 'Der Zeitraum ist ungültig.' }, 400)
  }
```

Load and filter entries:

```ts
  const scheduleUrl = new URL('/api/schedule-v2', request.url)
  scheduleUrl.searchParams.set('resource', 'entries')
  scheduleUrl.searchParams.set('from', from)
  scheduleUrl.searchParams.set('to', to)
  const scheduleResponse = await fetch(scheduleUrl, { headers: request.headers, cache: 'no-store' })
  if (!scheduleResponse.ok) {
    return json({ message: 'Der Dienstplan konnte nicht geladen werden.' }, 502)
  }
  const payload = await scheduleResponse.json().catch(() => ({})) as { entries?: ScheduleEntry[] }
  const entries = (payload.entries || [])
    .filter((entry) => entry.status === 'published')
    .sort((a, b) => `${a.date}-${a.start}-${a.employeeName}`.localeCompare(`${b.date}-${b.start}-${b.employeeName}`, 'de'))
  if (!entries.length) {
    return json({ message: 'Für diesen Zeitraum sind keine freigegebenen Dienste vorhanden.', code: 'NO_SCHEDULE_DATA' }, 404)
  }
```

Generate the PDF with exact columns and pagination:

```ts
  const settings = await readCompanySettings()
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  try {
    const logoResponse = await fetch(new URL(settings.logoUrl || '/habun-logo.png', request.url))
    if (logoResponse.ok) logo = await pdf.embedPng(await logoResponse.arrayBuffer())
  } catch {}

  const width = 842
  const height = 595
  const margin = 36
  const columns = [36, 105, 245, 310, 365, 420, 590]
  let page = pdf.addPage([width, height])
  let y = height - margin

  const drawHeader = () => {
    if (logo) {
      const scale = Math.min(72 / logo.width, 54 / logo.height)
      page.drawImage(logo, { x: margin, y: y - logo.height * scale + 5, width: logo.width * scale, height: logo.height * scale })
    }
    page.drawText(settings.companyName, { x: 125, y, size: 16, font: bold })
    page.drawText(settings.phone || 'Telefon nicht hinterlegt', { x: 125, y: y - 16, size: 8, font: regular })
    page.drawText(settings.email || 'E-Mail nicht hinterlegt', { x: 125, y: y - 29, size: 8, font: regular })
    page.drawText(`Dienstplan ${from} bis ${to}`, { x: margin, y: y - 62, size: 14, font: bold })
    y -= 92
    ;['Datum', 'Mitarbeiter', 'Beginn', 'Ende', 'Pause', 'Einsatzort', 'Arbeitsbereich'].forEach((label, index) => {
      page.drawText(label, { x: columns[index], y, size: 8, font: bold })
    })
    y -= 9
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: rgb(.45, .45, .45) })
    y -= 15
  }

  drawHeader()
  for (const entry of entries) {
    if (y < 55) {
      page = pdf.addPage([width, height])
      y = height - margin
      drawHeader()
    }
    const values = [
      entry.date,
      entry.employeeName.slice(0, 24),
      entry.start,
      entry.end,
      `${entry.pauseMinutes || 0} Min.`,
      String(entry.location || '–').slice(0, 28),
      String(entry.workArea || '–').slice(0, 28),
    ]
    values.forEach((value, index) => page.drawText(value, { x: columns[index], y, size: 7.5, font: regular }))
    y -= 18
  }

  const bytes = await pdf.save()
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Habun-Dienstplan-${from}-bis-${to}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export const config: Config = { path: '/api/schedule-pdf' }
```

- [ ] **Step 4: Test registrieren und prüfen**

Append `node scripts/schedule-pdf-test.mjs` to `verify:unified`, then run:

```bash
npm run verify:unified
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/schedule-pdf.mts scripts/schedule-pdf-test.mjs package.json
git commit -m "feat: add protected schedule PDF export"
```

---

### Task 3: Dateiantworten im Frontend validieren und Dienstplan-PDF verknüpfen

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `scripts/unified-portal-test.mjs`

**Interfaces:**
- Consumes: `apiBlob(path, options, expectedType)`, `/api/unified-reports`, `/api/schedule-pdf`.
- Produces: valide PDF-Vorschau, PDF-/Excel-Downloads und Management-Schaltfläche `Dienstplan als PDF`.

- [ ] **Step 1: Failing source assertions ergänzen**

```js
assert.match(app, /expectedType/)
assert.match(app, /Die Serverantwort ist keine gültige PDF-Datei/)
assert.match(app, /Dienstplan als PDF/)
assert.match(app, /\/api\/schedule-pdf/)
assert.match(app, /downloadSchedulePdf/)
```

Run:

```bash
node scripts/unified-portal-test.mjs
```

Expected: FAIL.

- [ ] **Step 2: `apiBlob` validieren**

Replace the current helper with:

```js
async function apiBlob(path, options = {}, expectedType = '') {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: expectedType || '*/*',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : { message: await response.text().catch(() => '') }
    throw new Error(body.message || `Die Datei konnte nicht erstellt werden (${response.status}).`)
  }
  if (expectedType && !contentType.toLowerCase().includes(expectedType.toLowerCase())) {
    throw new Error(expectedType === 'application/pdf'
      ? 'Die Serverantwort ist keine gültige PDF-Datei.'
      : 'Die Serverantwort ist keine gültige Excel-Datei.')
  }
  const disposition = response.headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const filename = encoded ? decodeURIComponent(encoded) : plain || 'Habun-Datei'
  return { blob: await response.blob(), filename: filename.replace(/[\\/]/g, '-') }
}
```

- [ ] **Step 3: Berichte mit dem korrekten erwarteten Typ abrufen**

Inside `ReportsPage.generate`:

```js
const expectedType = format === 'xlsx'
  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  : 'application/pdf'
const { blob, filename } = await apiBlob(
  '/api/unified-reports',
  { method: 'POST', body: JSON.stringify({ ...payload, format }) },
  expectedType,
)
if (previewOnly) {
  if (preview) URL.revokeObjectURL(preview)
  setPreview(URL.createObjectURL(blob))
} else {
  downloadBlob(blob, filename)
}
```

- [ ] **Step 4: Dienstplan-PDF in `SchedulePage` ergänzen**

```js
async function downloadSchedulePdf() {
  setBusy('schedule-pdf')
  setNotice(null)
  try {
    const { blob, filename } = await apiBlob(
      '/api/schedule-pdf',
      { method: 'POST', body: JSON.stringify({ from: week, to: addDays(week, 6) }) },
      'application/pdf',
    )
    downloadBlob(blob, filename)
    setNotice({ tone: 'success', text: 'Der Dienstplan wurde als PDF erstellt.' })
  } catch (error) {
    setNotice({ tone: 'error', text: error.message })
  } finally {
    setBusy('')
  }
}
```

Add this button only inside the existing `{management && ...}` toolbar:

```jsx
<button className="secondary-button" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>
  {busy === 'schedule-pdf' ? 'Dienstplan-PDF wird erstellt …' : 'Dienstplan als PDF'}
</button>
```

- [ ] **Step 5: Prüfen und committen**

```bash
node scripts/unified-portal-test.mjs
git add frontend/src/App.jsx scripts/unified-portal-test.mjs
git commit -m "feat: validate downloads and add schedule PDF action"
```

---

### Task 4: Mitarbeiter-Dienstplan ohne leere Tage darstellen

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`
- Create: `scripts/employee-schedule-compact-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `visibleEntries` aus `SchedulePage`.
- Produces: `employeeScheduleEntries`, `.employee-shift-list`, `.employee-shift-card`; Management behält `.week-cards`.

- [ ] **Step 1: Failing test schreiben**

Create `scripts/employee-schedule-compact-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')
const css = await readFile('frontend/src/styles.css', 'utf8')

assert.match(app, /employeeScheduleEntries/)
assert.match(app, /employee-shift-list/)
assert.match(app, /employee-shift-card/)
assert.match(app, /Keine freigegebenen Dienste in dieser Woche/)
assert.match(css, /\.employee-shift-list/)
assert.match(css, /\.employee-shift-card/)

console.log('Compact employee schedule tests passed')
```

Run:

```bash
node scripts/employee-schedule-compact-test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Mitarbeiterdienste chronologisch berechnen**

```js
const employeeScheduleEntries = useMemo(() => {
  if (management) return []
  return [...visibleEntries].sort((a, b) =>
    `${a.date}-${a.start}-${a.end}`.localeCompare(`${b.date}-${b.start}-${b.end}`),
  )
}, [management, visibleEntries])
```

- [ ] **Step 3: Bestehende Managementkarten beibehalten und Mitarbeiterliste separat rendern**

Replace the single unconditional `.week-cards` block with:

```jsx
{management ? (
  <div className="week-cards">
    {days.map((date) => {
      const dayEntries = visibleEntries.filter((entry) => entry.date === date)
      return (
        <section className="day-card" key={date}>
          <header>
            <div>
              <span>{formatDate(date, { weekday: 'long' })}</span>
              <strong>{formatDate(date, { day: '2-digit', month: '2-digit' })}</strong>
            </div>
            <button aria-label={`Dienst am ${formatDate(date)} hinzufügen`} onClick={() => startNew(date)}>＋</button>
          </header>
          <div>
            {dayEntries.length ? dayEntries.map((entry) => (
              <button type="button" className="shift-item" key={entry.id} onClick={() => edit(entry)}>
                <strong>{entry.start}–{entry.end}</strong>
                <span>{entry.employeeName}</span>
                <small>{entry.location} · {entry.workArea}</small>
                <em>{entry.pauseMinutes || 0} Min. Pause · {entry.status === 'published' ? 'Freigegeben' : 'Entwurf'}</em>
              </button>
            )) : <span className="day-empty">Kein Dienst</span>}
          </div>
        </section>
      )
    })}
  </div>
) : employeeScheduleEntries.length ? (
  <div className="employee-shift-list">
    {employeeScheduleEntries.map((entry) => (
      <article className="employee-shift-card" key={entry.id}>
        <div className="employee-shift-date">
          <span>{formatDate(entry.date, { weekday: 'long' })}</span>
          <strong>{formatDate(entry.date, { day: '2-digit', month: '2-digit', year: 'numeric' })}</strong>
        </div>
        <div className="employee-shift-details">
          <strong>{entry.start}–{entry.end}</strong>
          <span>{entry.location || 'Einsatzort nicht angegeben'}</span>
          <small>{entry.workArea || 'Arbeitsbereich nicht angegeben'} · {entry.pauseMinutes || 0} Min. Pause</small>
        </div>
      </article>
    ))}
  </div>
) : (
  <Empty>Keine freigegebenen Dienste in dieser Woche.</Empty>
)}
```

- [ ] **Step 4: Kompakte Styles ergänzen**

```css
.employee-shift-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.employee-shift-card {
  display: grid;
  grid-template-columns: minmax(118px, .34fr) minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 13px;
  padding: 14px 16px;
  background: var(--surface);
}
.employee-shift-date span,
.employee-shift-date strong,
.employee-shift-details strong,
.employee-shift-details span,
.employee-shift-details small { display: block; }
.employee-shift-date span,
.employee-shift-details span,
.employee-shift-details small { color: var(--muted); }
.employee-shift-date strong,
.employee-shift-details > strong { margin-top: 3px; color: var(--gold-bright); }
.employee-shift-details span { margin-top: 5px; }
.employee-shift-details small { margin-top: 4px; line-height: 1.4; }

@media (max-width: 900px) {
  .week-cards { grid-template-columns: repeat(7, minmax(70vw, 280px)); }
  .day-card { min-height: 190px; }
  .day-empty { min-height: 120px; }
}

@media (max-width: 680px) {
  .employee-shift-card {
    grid-template-columns: 1fr;
    gap: 9px;
    padding: 13px 14px;
  }
  .employee-shift-list { width: 100%; overflow: visible; }
}
```

- [ ] **Step 5: Test registrieren, prüfen und committen**

Append `node scripts/employee-schedule-compact-test.mjs` to `verify:unified`, then run:

```bash
npm run verify:unified
git add frontend/src/App.jsx frontend/src/styles.css scripts/employee-schedule-compact-test.mjs package.json
git commit -m "fix: hide empty employee schedule days"
```

---

### Task 5: Browserprüfungen für Dateien, Rollen und mobile Darstellung ergänzen

**Files:**
- Modify: `scripts/prepare-unified-e2e.mjs`
- Modify: `tests/e2e/unified-portal.spec.mjs`

**Interfaces:**
- Consumes: vorhandene E2E-Helfer und gemockte API-Routen.
- Produces: Browsernachweis für PDF, Excel, Dienstplan-PDF, Mitarbeiterrechte und eine kompakte Ein-Dienst-Ansicht.

- [ ] **Step 1: E2E-Daten auf einen eigenen veröffentlichten Dienst, einen fremden Dienst und einen Entwurf erweitern**

```js
const scheduleEntries = [
  {
    id: 'employee-published',
    employeeUserId: 'employee-user',
    employeeName: 'Test Mitarbeiter',
    date: '2026-08-03',
    start: '07:00',
    end: '15:00',
    pauseMinutes: 30,
    location: 'ZuKo',
    workArea: 'Zutrittskontrolle',
    status: 'published',
  },
  {
    id: 'employee-draft',
    employeeUserId: 'employee-user',
    employeeName: 'Test Mitarbeiter',
    date: '2026-08-04',
    start: '08:00',
    end: '16:00',
    pauseMinutes: 30,
    location: 'Entwurf',
    workArea: 'Nicht sichtbar',
    status: 'draft',
  },
  {
    id: 'other-published',
    employeeUserId: 'other-user',
    employeeName: 'Andere Person',
    date: '2026-08-05',
    start: '09:00',
    end: '17:00',
    pauseMinutes: 30,
    location: 'Fremder Ort',
    workArea: 'Nicht sichtbar',
    status: 'published',
  },
]
```

- [ ] **Step 2: Dateirouten mit korrektem Content-Type mocken**

PDF:

```js
await route.fulfill({
  status: 200,
  contentType: 'application/pdf',
  headers: { 'Content-Disposition': 'attachment; filename="Habun-Test.pdf"' },
  body: '%PDF-1.7\nHabun Security\n%%EOF',
})
```

Excel:

```js
await route.fulfill({
  status: 200,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  headers: { 'Content-Disposition': 'attachment; filename="Habun-Test.xlsx"' },
  body: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
})
```

- [ ] **Step 3: Managementdownloads prüfen**

```js
test('management downloads report and schedule files', async ({ page }) => {
  await openManagementPortal(page)
  await openNavigation(page, 'Berichte')

  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF herunterladen' }).click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/)

  const xlsxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel herunterladen' }).click()
  expect((await xlsxDownload).suggestedFilename()).toMatch(/\.xlsx$/)

  await openNavigation(page, 'Dienstplan')
  const scheduleDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Dienstplan als PDF' }).click()
  expect((await scheduleDownload).suggestedFilename()).toMatch(/\.pdf$/)
})
```

- [ ] **Step 4: Mitarbeiterrechte und kompakte Ansicht prüfen**

```js
test('employee sees one published own shift and no downloads', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEmployeePortal(page)
  await page.getByRole('button', { name: 'Dienstplan' }).click()

  await expect(page.locator('.employee-shift-card')).toHaveCount(1)
  await expect(page.getByText('07:00–15:00')).toBeVisible()
  await expect(page.getByText('Kein Dienst')).toHaveCount(0)
  await expect(page.getByText('Andere Person')).toHaveCount(0)
  await expect(page.getByText('Entwurf')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dienstplan als PDF' })).toHaveCount(0)
  await expect(page.getByText('PDF herunterladen')).toHaveCount(0)
  await expect(page.getByText('Excel herunterladen')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
```

- [ ] **Step 5: Browserprüfung ausführen und committen**

```bash
npm run test:e2e
git add scripts/prepare-unified-e2e.mjs tests/e2e/unified-portal.spec.mjs
git commit -m "test: cover downloads and compact employee schedule"
```

---

### Task 6: Vollständige Abschlussprüfung dokumentieren

**Files:**
- Modify: `docs/unified-portal/verification-report-2026-08-06.md`

- [ ] **Step 1: Gesamte Prüfung ausführen**

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Expected: alle Befehle erfolgreich.

- [ ] **Step 2: Screenshots kontrollieren**

Prüfkriterien:

```text
Mitarbeiteransicht zeigt nur vorhandene eigene freigegebene Dienste.
Tage ohne Dienst erzeugen keine Karte.
Keine horizontale Verschiebung auf 390 px Breite.
Management-Wochenansicht bleibt bedienbar.
Dienstplan-PDF-Schaltfläche ist nur für Management sichtbar.
Berichtsbuttons bleiben auf iPhone und Android vollständig sichtbar.
Logo und Schwarz-Gold-Farben sind unverändert.
```

- [ ] **Step 3: Verifikationsbericht ergänzen**

```markdown
## Berichte und kompakter Dienstplan

- PDF-Vorschau: bestanden
- PDF-Download: bestanden
- Excel-Download: bestanden
- Dienstplan-PDF Management: bestanden
- Dienstplan-PDF Mitarbeiter gesperrt: bestanden
- Mitarbeiter sieht nur eigene freigegebene Dienste: bestanden
- Leere Tage ausgeblendet: bestanden
- iPhone/Android ohne horizontales Überlaufen: bestanden
- Produktionsveröffentlichung: nicht durchgeführt
```

- [ ] **Step 4: Abschlusscommit**

```bash
git add docs/unified-portal/verification-report-2026-08-06.md
git commit -m "docs: record report and schedule verification"
```

- [ ] **Step 5: Schutzstatus bestätigen**

```text
Pull Request bleibt Draft.
Pull Request wird nicht zusammengeführt.
main bleibt unverändert.
Kein Netlify-Produktionsdeploy wird gestartet.
```
