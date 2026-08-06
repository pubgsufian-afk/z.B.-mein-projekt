# Berichte, Dienstplan-PDF und kompakter Mitarbeiter-Dienstplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF- und Excel-Berichte zuverlässig erzeugen, einen rollenbeschränkten Dienstplan-PDF-Export ergänzen und den Mitarbeiter-Dienstplan auf dem Handy ausschließlich mit vorhandenen Diensten kompakt darstellen.

**Architecture:** Die bestehende React-Oberfläche bleibt unverändert die einzige Portaloberfläche. Berichte und Dienstplan-PDFs werden serverseitig in Netlify Functions erzeugt; die Oberfläche lädt ausschließlich validierte Binärdateien herunter. Die Management-Wochenansicht bleibt erhalten, während normale Mitarbeiter eine eigene vertikale Liste ihrer freigegebenen Dienste erhalten.

**Tech Stack:** React 19, Netlify Functions, Netlify Identity, Neon/PostgreSQL, `pdf-lib`, `exceljs`, Node.js 22, Playwright.

## Global Constraints

- Arbeitszweig ist ausschließlich `fix-reports-live`.
- Kein Merge in `main` und keine Netlify-Produktionsveröffentlichung.
- Original-Logo `/habun-logo.png` und bestehende Schwarz-Gold-Farben bleiben unverändert.
- Normale Mitarbeiter dürfen keinen PDF- oder Excel-Download erhalten.
- Mitarbeiter sehen ausschließlich ihre eigenen freigegebenen Dienste.
- Tage ohne Dienst werden in der Mitarbeiteransicht nicht dargestellt.
- Admin, Hauptadmin und Einsatzleiter dürfen den freigegebenen Dienstplan als PDF herunterladen.
- Alle Dateiantworten müssen `Cache-Control: no-store` und `X-Content-Type-Options: nosniff` verwenden.
- Vor Abschluss müssen `npm run verify`, `npm run build` und `npm run test:e2e` erfolgreich sein.

---

## File Structure

- `frontend/src/App.jsx`
  - behält Navigation und Seitenkomponenten;
  - validiert Dateiantworten;
  - ergänzt den Dienstplan-PDF-Download;
  - trennt Management-Wochenansicht und kompakte Mitarbeiterliste.
- `frontend/src/styles.css`
  - ergänzt vertikale Mitarbeiter-Dienstkarten;
  - verkleinert mobile Management-Dienstkarten;
  - verhindert horizontales Überlaufen.
- `netlify/functions/unified-reports.mts`
  - bleibt der zentrale PDF-/Excel-Berichtsweg;
  - liefert eindeutige Fehlercodes und valide Dateitypen.
- `netlify/functions/reports-v2.mts`
  - behält den kompatiblen PDF-Berichtsweg mit derselben sicheren Mitarbeiterfilterung.
- `netlify/functions/schedule-pdf.mts`
  - neue, eigenständige Netlify Function für freigegebene Dienstpläne;
  - prüft Managementrolle serverseitig.
- `scripts/report-download-contract-test.mjs`
  - prüft sichere Mitarbeiterfilterung, PDF-/XLSX-Signaturen und Fehlercodes.
- `scripts/schedule-pdf-test.mjs`
  - prüft Rolle, Zeitraum, ausschließlich freigegebene Dienste und PDF-Signatur.
- `scripts/employee-schedule-compact-test.mjs`
  - prüft, dass Mitarbeiter nur vorhandene eigene freigegebene Dienste sehen.
- `tests/e2e/unified-portal.spec.mjs`
  - prüft Downloads, Rollen und mobile Darstellung in Browserabläufen.
- `package.json`
  - bindet die neuen Prüfskripte in `verify:unified` ein.

---

### Task 1: Berichtsdateien und Fehlermeldungen absichern

**Files:**
- Modify: `netlify/functions/unified-reports.mts`
- Modify: `netlify/functions/reports-v2.mts`
- Create: `scripts/report-download-contract-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `databaseConnectionString(): string | null`, `readCompanySettings()`, vorhandene `buildEmployeeFilter(userIds)`-Logik.
- Produces: `export function buildEmployeeFilter(userIds: string[]): { clause: string; params: string[] }`, PDF-Antwort `application/pdf`, XLSX-Antwort `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, Fehlercodes `NO_DATA`, `REPORT_QUERY_FAILED`, `REPORT_RENDER_FAILED`.

- [ ] **Step 1: Failing contract test für Filter und echte Dateisignaturen schreiben**

Create `scripts/report-download-contract-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import ExcelJS from 'exceljs'

const source = await readFile('netlify/functions/unified-reports.mts', 'utf8')
const legacy = await readFile('netlify/functions/reports-v2.mts', 'utf8')

for (const value of [source, legacy]) {
  assert.doesNotMatch(value, /cardinality\(\$3::text\[\]\)/)
  assert.doesNotMatch(value, /ANY\(\$3::text\[\]\)/)
  assert.match(value, /buildEmployeeFilter/)
  assert.match(value, /user_id IN \(/)
  assert.match(value, /REPORT_QUERY_FAILED/)
  assert.match(value, /REPORT_RENDER_FAILED/)
}

const pdf = await PDFDocument.create()
const page = pdf.addPage([595, 842])
const font = await pdf.embedFont(StandardFonts.Helvetica)
page.drawText('Habun Security Stundenbericht', { x: 30, y: 800, size: 12, font })
const pdfBytes = await pdf.save()
assert.equal(Buffer.from(pdfBytes).subarray(0, 5).toString(), '%PDF-')

const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('Arbeitszeiten').addRow(['Habun Security', '01.08.2026'])
const xlsx = Buffer.from(await workbook.xlsx.writeBuffer())
assert.equal(xlsx.subarray(0, 2).toString(), 'PK')

console.log('Report download contract tests passed')
```

- [ ] **Step 2: Test ausführen und erwartetes Fehlschlagen bestätigen**

Run:

```bash
node scripts/report-download-contract-test.mjs
```

Expected: FAIL, weil `REPORT_QUERY_FAILED` und `REPORT_RENDER_FAILED` noch nicht im Berichtscode vorhanden sind.

- [ ] **Step 3: Datenbankabfrage und Dateierzeugung getrennt behandeln**

In beiden Berichtsfunktionen die Abfrage separat kapseln:

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

Die PDF-/Excel-Erzeugung danach separat behandeln:

```ts
try {
  const bytes = format === 'xlsx'
    ? await buildExcel(rows, from, to)
    : await buildPdf(request, rows, from, to)
  // vorhandene Response mit korrektem Content-Type zurückgeben
} catch (error) {
  console.error('Habun report render', error)
  return json({ message: 'Die Berichtsdatei konnte nicht erzeugt werden.', code: 'REPORT_RENDER_FAILED' }, 500)
}
```

Leere Daten bleiben ein fachlicher Fehler:

```ts
if (!rows.length) {
  return json({ message: 'Für den ausgewählten Zeitraum wurden keine Daten gefunden.', code: 'NO_DATA' }, 404)
}
```

- [ ] **Step 4: Exportierbare Filterfunktion und korrekte Antwortheader sicherstellen**

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

PDF-Header:

```ts
headers: {
  'Content-Type': 'application/pdf',
  'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.pdf"`,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
}
```

XLSX-Header:

```ts
headers: {
  'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'Content-Disposition': `attachment; filename="Habun-Stundenbericht-${from}-bis-${to}.xlsx"`,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
}
```

- [ ] **Step 5: Prüfskript in `verify:unified` aufnehmen**

In `package.json`:

```json
"verify:unified": "node scripts/unified-portal-test.mjs && node scripts/employee-access-policy-test.mjs && node scripts/attendance-pause-test.mjs && node scripts/company-settings-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/report-download-contract-test.mjs"
```

- [ ] **Step 6: Tests ausführen**

Run:

```bash
npm run verify:unified
```

Expected: alle bisherigen Tests und `Report download contract tests passed`.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/unified-reports.mts netlify/functions/reports-v2.mts scripts/report-download-contract-test.mjs package.json
git commit -m "fix: harden report file generation"
```

---

### Task 2: Rollenbeschränkten Dienstplan-PDF-Endpunkt erstellen

**Files:**
- Create: `netlify/functions/schedule-pdf.mts`
- Create: `scripts/schedule-pdf-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: POST JSON `{ from: string, to: string }`, eingeloggte Netlify-Identity-Sitzung, `/api/schedule-v2?resource=entries&from=...&to=...`, `readCompanySettings()`.
- Produces: `POST /api/schedule-pdf`, PDF-Datei `Habun-Dienstplan-<from>-bis-<to>.pdf`, Fehlercode `NO_SCHEDULE_DATA`, Status 403 für Mitarbeiter.

- [ ] **Step 1: Failing source-and-contract test schreiben**

Create `scripts/schedule-pdf-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-pdf.mts', 'utf8')
assert.match(source, /const MANAGEMENT = new Set<Role>\(\['owner', 'admin', 'manager'\]\)/)
assert.match(source, /if \(!MANAGEMENT\.has\(current\.role\)\)/)
assert.match(source, /status === 'published'/)
assert.match(source, /readCompanySettings/)
assert.match(source, /application\/pdf/)
assert.match(source, /NO_SCHEDULE_DATA/)
assert.match(source, /Habun-Dienstplan-/)
assert.doesNotMatch(source, /employee.*download/i)

console.log('Schedule PDF tests passed')
```

- [ ] **Step 2: Test ausführen und fehlende Datei bestätigen**

Run:

```bash
node scripts/schedule-pdf-test.mjs
```

Expected: FAIL mit `ENOENT`, weil `schedule-pdf.mts` noch nicht existiert.

- [ ] **Step 3: Netlify Function mit Rollen- und Zeitraumprüfung erstellen**

Create `netlify/functions/schedule-pdf.mts` with these core contracts:

```ts
import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { getUser, verifyRequestOrigin } from '@netlify/identity'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readCompanySettings } from './_shared/company-settings.mts'

type Role = 'owner' | 'admin' | 'manager' | 'employee' | 'pending'
const MANAGEMENT = new Set<Role>(['owner', 'admin', 'manager'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
```

Request validation:

```ts
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

Dienste laden und ausschließlich freigegebene Einträge verwenden:

```ts
const url = new URL('/api/schedule-v2', request.url)
url.searchParams.set('resource', 'entries')
url.searchParams.set('from', from)
url.searchParams.set('to', to)
const response = await fetch(url, { headers: request.headers, cache: 'no-store' })
if (!response.ok) return json({ message: 'Der Dienstplan konnte nicht geladen werden.' }, 502)
const payload = await response.json().catch(() => ({})) as { entries?: ScheduleEntry[] }
const entries = (payload.entries || [])
  .filter((entry) => entry.status === 'published')
  .sort((a, b) => `${a.date}-${a.start}-${a.employeeName}`.localeCompare(`${b.date}-${b.start}-${b.employeeName}`, 'de'))
if (!entries.length) {
  return json({ message: 'Für diesen Zeitraum sind keine freigegebenen Dienste vorhanden.', code: 'NO_SCHEDULE_DATA' }, 404)
}
```

PDF-Kopf und Tabellenfelder:

```ts
const settings = await readCompanySettings()
const pdf = await PDFDocument.create()
const regular = await pdf.embedFont(StandardFonts.Helvetica)
const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
// Logo über settings.logoUrl laden, ohne Datei oder Farben zu verändern.
// Spalten: Datum, Mitarbeiter, Beginn, Ende, Pause, Einsatzort, Arbeitsbereich.
```

Response:

```ts
return new Response(await pdf.save(), {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="Habun-Dienstplan-${from}-bis-${to}.pdf"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  },
})

export const config: Config = { path: '/api/schedule-pdf' }
```

- [ ] **Step 4: Test in `verify:unified` aufnehmen**

```json
"verify:unified": "node scripts/unified-portal-test.mjs && node scripts/employee-access-policy-test.mjs && node scripts/attendance-pause-test.mjs && node scripts/company-settings-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/report-download-contract-test.mjs && node scripts/schedule-pdf-test.mjs"
```

- [ ] **Step 5: Tests und Build ausführen**

Run:

```bash
npm run verify:unified
npm run build
```

Expected: `Schedule PDF tests passed` und erfolgreicher Funktions-Build.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/schedule-pdf.mts scripts/schedule-pdf-test.mjs package.json
git commit -m "feat: add protected schedule PDF export"
```

---

### Task 3: Datei-Download im Frontend validieren und Dienstplan-PDF-Schaltfläche ergänzen

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `scripts/unified-portal-test.mjs`

**Interfaces:**
- Consumes: `apiBlob(path, options, expectedType)`, POST `/api/unified-reports`, POST `/api/schedule-pdf`.
- Produces: verständliche Downloadfehler, PDF-Vorschau nur bei echtem PDF, Management-Schaltfläche `Dienstplan als PDF`.

- [ ] **Step 1: Failing Source-Test ergänzen**

In `scripts/unified-portal-test.mjs`:

```js
assert.match(app, /expectedType/)
assert.match(app, /Die Serverantwort ist keine gültige PDF-Datei/)
assert.match(app, /Dienstplan als PDF/)
assert.match(app, /\/api\/schedule-pdf/)
assert.match(app, /downloadSchedulePdf/)
```

- [ ] **Step 2: Test ausführen und Fehlschlagen bestätigen**

Run:

```bash
node scripts/unified-portal-test.mjs
```

Expected: FAIL, weil Dateitypvalidierung und Dienstplan-PDF-Schaltfläche noch fehlen.

- [ ] **Step 3: `apiBlob` um erwarteten Dateityp erweitern**

In `frontend/src/App.jsx`:

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

- [ ] **Step 4: Berichtsaufrufe mit erwarteten Dateitypen versehen**

```js
const expectedType = format === 'xlsx'
  ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  : 'application/pdf'
const { blob, filename } = await apiBlob(
  '/api/unified-reports',
  { method: 'POST', body: JSON.stringify({ ...payload, format }) },
  expectedType,
)
```

Vor einer PDF-Vorschau prüfen:

```js
if (previewOnly && blob.type !== 'application/pdf') {
  throw new Error('Die Serverantwort ist keine gültige PDF-Datei.')
}
```

- [ ] **Step 5: Management-Dienstplan-PDF herunterladen**

In `SchedulePage`:

```js
async function downloadSchedulePdf() {
  setBusy('schedule-pdf')
  setNotice(null)
  try {
    const { blob, filename } = await apiBlob(
      '/api/schedule-pdf',
      {
        method: 'POST',
        body: JSON.stringify({ from: week, to: addDays(week, 6) }),
      },
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

Im Management-Toolbar:

```jsx
<button
  className="secondary-button"
  disabled={Boolean(busy)}
  onClick={downloadSchedulePdf}
>
  {busy === 'schedule-pdf' ? 'Dienstplan-PDF wird erstellt …' : 'Dienstplan als PDF'}
</button>
```

Die Schaltfläche muss innerhalb `{management && ...}` bleiben.

- [ ] **Step 6: Source-Tests ausführen**

Run:

```bash
node scripts/unified-portal-test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx scripts/unified-portal-test.mjs
git commit -m "feat: add validated report and schedule downloads"
```

---

### Task 4: Mitarbeiter-Dienstplan auf vorhandene Dienste reduzieren

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`
- Create: `scripts/employee-schedule-compact-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `visibleEntries` mit bereits serverseitig eingeschränkten eigenen freigegebenen Diensten.
- Produces: `employeeScheduleEntries`, vertikale `.employee-shift-list`, `.employee-shift-card`; Management behält `.week-cards`.

- [ ] **Step 1: Failing compact-schedule test schreiben**

Create `scripts/employee-schedule-compact-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, css] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
])

assert.match(app, /employeeScheduleEntries/)
assert.match(app, /employee-shift-list/)
assert.match(app, /employee-shift-card/)
assert.match(app, /management \? .*week-cards/s)
assert.match(app, /Keine freigegebenen Dienste in dieser Woche/)
assert.doesNotMatch(app, /!management.*days\.map/s)
assert.match(css, /\.employee-shift-list/)
assert.match(css, /\.employee-shift-card/)
assert.match(css, /grid-template-columns: 1fr/)

console.log('Compact employee schedule tests passed')
```

- [ ] **Step 2: Test ausführen und Fehlschlagen bestätigen**

Run:

```bash
node scripts/employee-schedule-compact-test.mjs
```

Expected: FAIL, weil Mitarbeiter noch die Sieben-Tage-Karten sehen.

- [ ] **Step 3: Chronologische Mitarbeiterliste berechnen**

In `SchedulePage` nach `visibleEntries`:

```js
const employeeScheduleEntries = useMemo(() => {
  if (management) return []
  return [...visibleEntries].sort((a, b) =>
    `${a.date}-${a.start}-${a.end}`.localeCompare(`${b.date}-${b.start}-${b.end}`),
  )
}, [management, visibleEntries])
```

- [ ] **Step 4: Management- und Mitarbeiterdarstellung trennen**

Management behält die bestehende Wochenansicht:

```jsx
{management ? (
  <div className="week-cards">
    {days.map((date) => {
      const dayEntries = visibleEntries.filter((entry) => entry.date === date)
      return <section className="day-card" key={date}>{/* bestehende Managementkarte */}</section>
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

Dadurch werden keine Karten für Tage ohne Dienst erzeugt.

- [ ] **Step 5: Kompakte mobile Styles ergänzen**

In `frontend/src/styles.css`:

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
.employee-shift-details small {
  display: block;
}
.employee-shift-date span,
.employee-shift-details span,
.employee-shift-details small {
  color: var(--muted);
}
.employee-shift-date strong,
.employee-shift-details > strong {
  margin-top: 3px;
  color: var(--gold-bright);
}
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

Die bestehenden Schwarz-Gold-Variablen werden verwendet; keine Farbcodes des Logos werden geändert.

- [ ] **Step 6: Test in `verify:unified` aufnehmen**

```json
"verify:unified": "node scripts/unified-portal-test.mjs && node scripts/employee-access-policy-test.mjs && node scripts/attendance-pause-test.mjs && node scripts/company-settings-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/report-download-contract-test.mjs && node scripts/schedule-pdf-test.mjs && node scripts/employee-schedule-compact-test.mjs"
```

- [ ] **Step 7: Tests ausführen**

Run:

```bash
npm run verify:unified
```

Expected: `Compact employee schedule tests passed` und alle bisherigen Tests erfolgreich.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.jsx frontend/src/styles.css scripts/employee-schedule-compact-test.mjs package.json
git commit -m "fix: compact employee schedule on mobile"
```

---

### Task 5: Browserabläufe für Downloads, Rollen und mobile Ansicht erweitern

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `scripts/prepare-unified-e2e.mjs`

**Interfaces:**
- Consumes: gemockte `/api/unified-reports`, `/api/schedule-pdf`, `/api/schedule-v2`, Management- und Mitarbeiter-Sitzungen.
- Produces: Browsernachweis für PDF, Excel, Rollenbegrenzung, einen einzelnen Mitarbeiterdienst und mehrere chronologische Dienste.

- [ ] **Step 1: E2E-Testdaten für einen einzelnen veröffentlichten Dienst ergänzen**

In `scripts/prepare-unified-e2e.mjs` eine Mitarbeiterantwort bereitstellen:

```js
const employeePublishedShift = {
  id: 'shift-employee-1',
  employeeUserId: 'employee-user',
  employeeName: 'Test Mitarbeiter',
  date: '2026-08-03',
  start: '07:00',
  end: '15:00',
  pauseMinutes: 30,
  location: 'ZuKo',
  workArea: 'Zutrittskontrolle',
  status: 'published',
}
```

Zusätzlich einen fremden und einen Entwurfsdienst einfügen, damit der Test deren Unsichtbarkeit prüft.

- [ ] **Step 2: PDF- und Excel-Antworten im Browsermock mit korrektem Dateityp liefern**

```js
await route.fulfill({
  status: 200,
  contentType: 'application/pdf',
  headers: { 'Content-Disposition': 'attachment; filename="Habun-Test.pdf"' },
  body: '%PDF-1.7\nHabun Security\n%%EOF',
})
```

Für Excel:

```js
await route.fulfill({
  status: 200,
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  headers: { 'Content-Disposition': 'attachment; filename="Habun-Test.xlsx"' },
  body: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
})
```

- [ ] **Step 3: Management-Berichtsdownloads testen**

In `tests/e2e/unified-portal.spec.mjs`:

```js
test('management can preview PDF and download PDF and Excel', async ({ page }) => {
  await openManagementPortal(page)
  await openNavigation(page, 'Berichte')
  await page.getByRole('button', { name: 'PDF-Vorschau' }).click()
  await expect(page.getByTitle('PDF-Vorschau')).toBeVisible()

  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF herunterladen' }).click()
  expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/)

  const xlsxDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel herunterladen' }).click()
  expect((await xlsxDownload).suggestedFilename()).toMatch(/\.xlsx$/)
})
```

- [ ] **Step 4: Dienstplan-PDF nur für Management testen**

```js
test('management downloads schedule PDF', async ({ page }) => {
  await openManagementPortal(page)
  await openNavigation(page, 'Dienstplan')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Dienstplan als PDF' }).click()
  expect((await download).suggestedFilename()).toMatch(/Habun-Dienstplan-.*\.pdf$/)
})
```

Mitarbeitertest:

```js
test('employee cannot see file downloads', async ({ page }) => {
  await openEmployeePortal(page)
  await page.getByRole('button', { name: 'Dienstplan' }).click()
  await expect(page.getByRole('button', { name: 'Dienstplan als PDF' })).toHaveCount(0)
  await expect(page.getByText('PDF herunterladen')).toHaveCount(0)
  await expect(page.getByText('Excel herunterladen')).toHaveCount(0)
})
```

- [ ] **Step 5: Leere Tage und horizontales Überlaufen prüfen**

```js
test('employee sees only existing published shift on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openEmployeePortal(page)
  await page.getByRole('button', { name: 'Dienstplan' }).click()
  await expect(page.getByText('07:00–15:00')).toBeVisible()
  await expect(page.getByText('Kein Dienst')).toHaveCount(0)
  await expect(page.locator('.employee-shift-card')).toHaveCount(1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
```

- [ ] **Step 6: E2E-Test ausführen**

Run:

```bash
npm run test:e2e
```

Expected: alle Desktop-, iPhone- und Android-Abläufe erfolgreich.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/unified-portal.spec.mjs scripts/prepare-unified-e2e.mjs
git commit -m "test: cover report downloads and compact schedule"
```

---

### Task 6: Vollständige Abschlussprüfung ohne Veröffentlichung

**Files:**
- Modify: `docs/unified-portal/verification-report-2026-08-06.md`
- No production files beyond the already tested changes.

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: dokumentierter Prüfstand im geschützten Zweig; kein Merge und kein Deploy.

- [ ] **Step 1: Gesamte Quellcodeprüfung ausführen**

```bash
npm install --no-audit --no-fund
npm run verify
```

Expected: alle Rollen-, Datenbank-, Berichts-, PDF-, Excel- und Dienstplantests erfolgreich.

- [ ] **Step 2: Produktions-Build im Prüfzweig erzeugen**

```bash
npm run build
```

Expected: erfolgreicher Frontend- und Netlify-Functions-Build ohne Fehler.

- [ ] **Step 3: Browserprüfung vollständig ausführen**

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

Expected: alle Desktop-, iPhone- und Android-Abläufe erfolgreich.

- [ ] **Step 4: Vorschau-Screenshots visuell kontrollieren**

Zu prüfen:

```text
- Mitarbeiteransicht zeigt nur vorhandene Dienste.
- Kein „Kein Dienst“-Kasten bei nicht belegten Tagen.
- Keine horizontale Seitenverschiebung.
- Admin-Dienstplan bleibt bedienbar und ist auf dem Handy kompakter.
- „Dienstplan als PDF“ ist nur bei Management sichtbar.
- Berichtsschaltflächen bleiben innerhalb des sichtbaren Bereichs.
- Logo und Schwarz-Gold-Farben sind unverändert.
```

- [ ] **Step 5: Verifikationsbericht aktualisieren**

In `docs/unified-portal/verification-report-2026-08-06.md` ergänzen:

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

- [ ] **Step 6: Abschlusscommit**

```bash
git add docs/unified-portal/verification-report-2026-08-06.md
git commit -m "docs: record report and schedule verification"
```

- [ ] **Step 7: Schutzstatus bestätigen**

```text
- Pull Request bleibt Draft.
- Pull Request wird nicht zusammengeführt.
- `main` bleibt unverändert.
- Kein Netlify-Produktionsdeploy wird gestartet.
```
