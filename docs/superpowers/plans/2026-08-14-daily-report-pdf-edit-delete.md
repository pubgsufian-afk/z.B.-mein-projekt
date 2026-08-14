# Tagesbericht PDF, Bearbeiten und Löschen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden Admin-Tagesbericht um Bearbeiten, endgültiges Löschen, Einzel-PDF und Tages-PDF mit zentralem Habun-Logo zu erweitern.

**Architecture:** Die vorhandene `/api/daily-reports`-Funktion bleibt die JSON-Verwaltung und wird um Datumfilter, `PATCH` und `DELETE` erweitert. Ein neuer, getrennt getesteter `/api/daily-reports-pdf`-Endpunkt erzeugt serverseitig A4-PDFs mit `pdf-lib` und dem bereits vorhandenen zentralen PDF-Branding. Die bestehende React-Übersicht bleibt der einzige UI-Einstieg; sie erhält Datumsfilter und Aktionen, ohne Zeiterfassung, Dienstplan oder bestehende Berichts-/Stundenzettel-Funktionen zu verändern.

**Tech Stack:** React 19, Netlify Functions, `@netlify/blobs`, `@netlify/identity`, `pdf-lib`, bestehende PDF-Branding-Helfer, Node-Source-Contract-Tests, Playwright.

## Global Constraints

- Nur `owner` und `admin` dürfen Tagesberichte lesen, schreiben, bearbeiten, löschen oder als PDF exportieren.
- `manager` und `employee` erhalten serverseitig `403` und sehen die Funktionen im UI nicht.
- Berichtstext ist Pflicht und auf maximal 1.000 Wörter begrenzt.
- Tagesgrenzen und Datumsfilter verwenden durchgehend `Europe/Berlin`.
- `id`, `authorId`, `authorName` und `createdAt` bleiben beim Bearbeiten unverändert.
- `updatedAt`, `updatedById` und `updatedByName` werden nur serverseitig gesetzt.
- Löschen ist endgültig, ohne Papierkorb, aber nur nach einer UI-Sicherheitsabfrage.
- Bestehende Einträge im Store `portal-daily-reports` müssen ohne Migration weiter funktionieren.
- Einzel-PDF und Tages-PDF verwenden das bereits konfigurierte zentrale Firmenlogo; kein zweites Logo-System.
- Keine KI, Fotos, Anhänge oder Autosave-Funktion hinzufügen.
- Zeiterfassung, Dienstplan und bestehende PDF-/Excel-Berichte bleiben funktional unverändert.

---

## File Structure

- `netlify/functions/daily-reports.mts` — einzige JSON-CRUD-Schnittstelle und Auflösung von öffentlicher Bericht-ID auf internen Blob-Key.
- `netlify/functions/_shared/daily-report-model.mts` — neue kleine, testbare gemeinsame Report-Typen, Berlin-Datumslogik, Filter-/Dateinamen-Helfer und Store-Lookup; wird von JSON- und PDF-Endpunkt gemeinsam benutzt.
- `netlify/functions/daily-reports-pdf.mts` — ausschließlich PDF-Lesen/Rendern; keine Mutation.
- `frontend/src/AdminOverview.jsx` — Datumsfilter, Edit-/Delete-Flows, Einzel-/Tages-PDF-Download.
- `frontend/src/admin-overview.css` — mobile Berichtsverwaltung und Aktionsflächen.
- `scripts/admin-overview-daily-report-test.mjs` — bestehender Source-Contract, erweitert um neue UI/API/PDF-Verträge.
- `scripts/daily-report-crud-test.mjs` — neue isolierte Tests für Datum, Validierung und CRUD-Helfer.
- `scripts/daily-report-pdf-test.mjs` — neue Source-/PDF-Helfer-Verträge inklusive Logo, Header und Dateinamen.
- `tests/e2e/unified-portal.spec.mjs` — Browserfluss für Filter, Bearbeiten, Löschen und Downloads.
- `package.json` und `.github/workflows/admin-overview-daily-report-verify.yml` — neue Tests in bestehende Verifikation integrieren.

---

### Task 1: Gemeinsames Tagesbericht-Modell und CRUD-Verträge

**Files:**
- Create: `netlify/functions/_shared/daily-report-model.mts`
- Create: `scripts/daily-report-crud-test.mjs`
- Modify: `netlify/functions/daily-reports.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Netlify Blob store `portal-daily-reports` und `requirePortalRole(['owner', 'admin'])`.
- Produces: `DailyReport`, `BERLIN_TIME_ZONE`, `isIsoDateKey(value)`, `berlinDateKey(value)`, `listDailyReports(store, date?)`, `findDailyReportById(store, id)`, `safePdfFilenamePart(value)` für Task 2.

- [ ] **Step 1: Write the failing helper/CRUD test**

Create `scripts/daily-report-crud-test.mjs` with assertions that import the shared helpers and prove Berlin-date filtering and immutable metadata:

```js
import assert from 'node:assert/strict'
import {
  BERLIN_TIME_ZONE,
  berlinDateKey,
  isIsoDateKey,
  safePdfFilenamePart,
} from '../netlify/functions/_shared/daily-report-model.mts'

assert.equal(BERLIN_TIME_ZONE, 'Europe/Berlin')
assert.equal(isIsoDateKey('2026-08-14'), true)
assert.equal(isIsoDateKey('14.08.2026'), false)
assert.equal(berlinDateKey('2026-08-14T22:30:00.000Z'), '2026-08-15')
assert.equal(safePdfFilenamePart('Ädmin / Test'), 'Admin-Test')

const source = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(new URL('../netlify/functions/daily-reports.mts', import.meta.url), 'utf8'))
assert.match(source, /PATCH/)
assert.match(source, /DELETE/)
assert.match(source, /updatedAt/)
assert.match(source, /updatedById/)
assert.match(source, /updatedByName/)
assert.match(source, /verifyRequestOrigin/)
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/)
console.log('daily report CRUD contract: ok')
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --experimental-strip-types scripts/daily-report-crud-test.mjs
```

Expected: FAIL because `_shared/daily-report-model.mts` does not exist and `PATCH`/`DELETE` are not implemented.

- [ ] **Step 3: Add the shared model with exact public helpers**

Create `netlify/functions/_shared/daily-report-model.mts` with:

```ts
import { getStore } from '@netlify/blobs'

export const BERLIN_TIME_ZONE = 'Europe/Berlin'
export const DAILY_REPORT_STORE = 'portal-daily-reports'

export type DailyReport = {
  id: string
  text: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt?: string
  updatedById?: string
  updatedByName?: string
}

export function reportStore() {
  return getStore({ name: DAILY_REPORT_STORE, consistency: 'strong' })
}

export function isIsoDateKey(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

export function berlinDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function safePdfFilenamePart(value: unknown) {
  return String(value || 'Admin')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Admin'
}

export async function listDailyReports(store = reportStore(), date?: string) {
  const listed = await store.list({ prefix: 'reports/' })
  const rows = await Promise.all(listed.blobs.map((blob) =>
    store.get(blob.key, { type: 'json' }).then((report) => ({ key: blob.key, report: report as DailyReport | null }))))
  return rows
    .filter((row): row is { key: string; report: DailyReport } => Boolean(row.report?.id && row.report?.createdAt && row.report?.text))
    .filter((row) => !date || berlinDateKey(row.report.createdAt) === date)
    .sort((a, b) => String(b.report.createdAt).localeCompare(String(a.report.createdAt)))
}

export async function findDailyReportById(store = reportStore(), id: string) {
  if (!id) return null
  const rows = await listDailyReports(store)
  return rows.find((row) => row.report.id === id) || null
}
```

- [ ] **Step 4: Extend `/api/daily-reports` minimally**

Refactor `netlify/functions/daily-reports.mts` to import the shared type/store helpers, keep existing POST behavior, and support:

```ts
if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
  return response({ message: 'Methode nicht erlaubt.' }, 405)
}

const url = new URL(request.url)
const date = url.searchParams.get('date') || ''
if (request.method === 'GET') {
  if (date && !isIsoDateKey(date)) return response({ message: 'Ungültiges Datum.' }, 400)
  const rows = await listDailyReports(reportStore(), date || undefined)
  return response({ reports: rows.map(({ report }) => report) })
}
```

For `PATCH`, after origin validation and `id` lookup, retain original identity/time fields and update only text plus server metadata:

```ts
const found = await findDailyReportById(store, id)
if (!found) return response({ message: 'Bericht nicht gefunden.' }, 404)
const validation = validateDailyReportText(body?.text)
if (!validation.ok) return response({ message: validation.message }, validation.status)
const updated: DailyReport = {
  ...found.report,
  text: validation.text,
  updatedAt: new Date().toISOString(),
  updatedById: current.userId,
  updatedByName: await authorNameFor(current),
}
await store.setJSON(found.key, updated)
return response({ report: updated })
```

For `DELETE`, validate origin, locate only by public id, delete `found.key`, and return `{ deleted: true, id }`. Never accept a blob key from the browser.

- [ ] **Step 5: Add the test to npm verification**

Add a script such as:

```json
"verify:daily-reports": "node --experimental-strip-types scripts/daily-report-crud-test.mjs"
```

and include it in the feature workflow before build.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm run verify:daily-reports
npm run verify:admin-overview
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/daily-report-model.mts netlify/functions/daily-reports.mts scripts/daily-report-crud-test.mjs package.json
git commit -m "feat: add daily report editing and deletion API"
```

---

### Task 2: Professioneller Einzel- und Tages-PDF-Endpunkt

**Files:**
- Create: `netlify/functions/daily-reports-pdf.mts`
- Create: `scripts/daily-report-pdf-test.mjs`
- Reuse: `netlify/functions/_shared/pdf-shield-logo.mts`
- Reuse: `netlify/functions/_shared/pdf-branding.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DailyReport`, `findDailyReportById`, `listDailyReports`, `isIsoDateKey`, `safePdfFilenamePart` from Task 1 and `loadOriginalLogo`/`drawCenteredShieldLogo` from existing PDF helpers.
- Produces: GET `/api/daily-reports-pdf?id=<id>` and GET `/api/daily-reports-pdf?date=YYYY-MM-DD` returning `application/pdf` attachment.

- [ ] **Step 1: Write the failing PDF contract test**

Create `scripts/daily-report-pdf-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../netlify/functions/daily-reports-pdf.mts', import.meta.url), 'utf8')
assert.match(source, /PDFDocument/)
assert.match(source, /StandardFonts/)
assert.match(source, /loadOriginalLogo/)
assert.match(source, /drawCenteredShieldLogo/)
assert.match(source, /Content-Type.*application\/pdf/s)
assert.match(source, /Content-Disposition/)
assert.match(source, /Tagesbericht/)
assert.match(source, /Seite/)
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/)
console.log('daily report PDF source contract: ok')
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node scripts/daily-report-pdf-test.mjs
```

Expected: FAIL because `daily-reports-pdf.mts` does not exist.

- [ ] **Step 3: Implement PDF request selection and authorization**

Create `netlify/functions/daily-reports-pdf.mts` and begin with:

```ts
import type { Config } from '@netlify/functions'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { requirePortalRole } from './_shared/portal-role.mts'
import { drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'
import {
  findDailyReportById, isIsoDateKey, listDailyReports, reportStore, safePdfFilenamePart,
  type DailyReport,
} from './_shared/daily-report-model.mts'

export default async function dailyReportsPdf(request: Request) {
  if (request.method !== 'GET') return Response.json({ message: 'Methode nicht erlaubt.' }, { status: 405 })
  const access = await requirePortalRole(['owner', 'admin'])
  if (access.response) return access.response
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || ''
  const date = url.searchParams.get('date') || ''
  if ((!id && !date) || (id && date)) return Response.json({ message: 'Bericht-ID oder Datum angeben.' }, { status: 400 })
  if (date && !isIsoDateKey(date)) return Response.json({ message: 'Ungültiges Datum.' }, { status: 400 })
  // resolve reports, render, return PDF
}

export const config: Config = { path: '/api/daily-reports-pdf' }
```

ID export resolves one report; date export loads all reports for that Berlin day and sorts them ascending before rendering:

```ts
const chronological = rows.map(({ report }) => report)
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
```

- [ ] **Step 4: Implement deterministic A4 renderer**

Use A4 points `[595.28, 841.89]`, 48pt side margins, 44pt bottom footer reserve, Helvetica/Helvetica-Bold. Centralize layout in small local helpers:

```ts
const PAGE = [595.28, 841.89] as const
const MARGIN_X = 48
const FOOTER_Y = 24
const BODY_SIZE = 10.5
const LINE_HEIGHT = 15

function wrapText(text: string, font, size: number, maxWidth: number) {
  const lines: string[] = []
  for (const paragraph of String(text).split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate
      else { if (line) lines.push(line); line = word }
    }
    if (line) lines.push(line)
    if (!words.length) lines.push('')
  }
  return lines
}
```

Every first page draws the centered existing company logo, company title and `Tagesbericht`/`Tagesberichte`. Each report block renders author, creation timestamp, optional `Zuletzt bearbeitet ...`, then wrapped text. When `y < 64`, create a new page before drawing the next line. Do not truncate report content.

After all pages exist, iterate `pdf.getPages()` and draw `Seite X von Y` centered in the footer.

- [ ] **Step 5: Return professional attachment names**

Single report:

```ts
const filename = `Tagesbericht_${reportDate}_${safePdfFilenamePart(report.authorName)}.pdf`
```

Daily export:

```ts
const filename = `Tagesberichte_${date}.pdf`
```

Return:

```ts
return new Response(await pdf.save(), {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  },
})
```

- [ ] **Step 6: Run PDF tests and existing branding tests**

```bash
node scripts/daily-report-pdf-test.mjs
node scripts/pdf-branding-test.mjs
node scripts/final-export-logo-test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/daily-reports-pdf.mts scripts/daily-report-pdf-test.mjs package.json
git commit -m "feat: add branded daily report PDF exports"
```

---

### Task 3: Mobile Berichtsverwaltung im Admin-Dashboard

**Files:**
- Modify: `frontend/src/AdminOverview.jsx`
- Modify: `frontend/src/admin-overview.css`
- Modify: `scripts/admin-overview-daily-report-test.mjs`
- Modify if required by the repository's source-repair convention: `scripts/apply-admin-overview-daily-report.mjs`

**Interfaces:**
- Consumes: Task 1 JSON API and Task 2 PDF endpoint.
- Produces: Datumsfilter, `PDF`, `Bearbeiten`, `Löschen`, `Tages-PDF herunterladen`, visible last-edit metadata.

- [ ] **Step 1: Extend source-contract test first**

Add assertions to `scripts/admin-overview-daily-report-test.mjs` for exact UI/API contract strings:

```js
assert.match(overviewSource, /Tages-PDF herunterladen/)
assert.match(overviewSource, />PDF</)
assert.match(overviewSource, /Bearbeiten/)
assert.match(overviewSource, /Löschen/)
assert.match(overviewSource, /Zuletzt bearbeitet/)
assert.match(overviewSource, /daily-reports-pdf/)
assert.match(overviewSource, /method: 'PATCH'/)
assert.match(overviewSource, /method: 'DELETE'/)
assert.match(overviewSource, /Bericht wirklich endgültig löschen\?/)
assert.match(overviewSource, /type="date"/)
```

If `apply-admin-overview-daily-report.mjs` rewrites generated source during `npm run build`, add the same new source there; otherwise the build would silently revert the feature.

- [ ] **Step 2: Run feature contract and verify RED**

```bash
npm run verify:admin-overview
```

Expected: FAIL on the first missing new action.

- [ ] **Step 3: Add report-management state and filtered loading**

In `AdminOverview`, add:

```js
const [reportDate, setReportDate] = useState(today)
const [editingReport, setEditingReport] = useState(null)
const [reportBusyId, setReportBusyId] = useState('')
```

Replace unfiltered history loading with:

```js
const loadReportsForDate = useCallback(async (date = reportDate) => {
  setLoadingReports(true)
  try {
    const data = await apiJson(`/api/daily-reports?date=${encodeURIComponent(date)}`)
    setReports(Array.isArray(data.reports) ? data.reports : [])
    setReportNotice(null)
  } catch (error) {
    setReports([])
    setReportNotice({ tone: 'error', text: error.message || 'Die Berichte konnten nicht geladen werden.' })
  } finally {
    setLoadingReports(false)
  }
}, [reportDate])
```

Date-input change updates `reportDate` and reloads exactly that date.

- [ ] **Step 4: Reuse compose dialog for editing**

Opening edit sets `editingReport` and preloads the text. Save chooses POST or PATCH:

```js
const path = editingReport
  ? `/api/daily-reports?id=${encodeURIComponent(editingReport.id)}`
  : '/api/daily-reports'
const method = editingReport ? 'PATCH' : 'POST'
await apiJson(path, { method, body: JSON.stringify({ text: reportText }) })
```

After success, clear text/edit state, return to history, and reload the selected day. Keep the 1,000-word client check.

- [ ] **Step 5: Add permanent delete flow**

Implement only after explicit browser confirmation:

```js
const deleteReport = async (report) => {
  if (!window.confirm('Bericht wirklich endgültig löschen?')) return
  setReportBusyId(report.id)
  try {
    await apiJson(`/api/daily-reports?id=${encodeURIComponent(report.id)}`, { method: 'DELETE' })
    await loadReportsForDate(reportDate)
  } catch (error) {
    setReportNotice({ tone: 'error', text: error.message || 'Der Bericht konnte nicht gelöscht werden.' })
  } finally {
    setReportBusyId('')
  }
}
```

Disable edit/delete actions only for the currently busy report.

- [ ] **Step 6: Add authenticated PDF download helper**

Use `fetch` with same-origin credentials, not `window.open`, so HTTP errors can be shown and the response filename can be respected:

```js
async function downloadPdf(path, fallbackName) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || 'Die PDF konnte nicht erstellt werden.')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename="?([^";]+)"?/i)
  const name = matched?.[1] || fallbackName
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}
```

Per-entry button calls `/api/daily-reports-pdf?id=...`; top button calls `/api/daily-reports-pdf?date=...`. Disable Tages-PDF when `reports.length === 0`.

- [ ] **Step 7: Render edit metadata and mobile controls**

Each entry renders, only when present:

```jsx
{report.updatedAt && (
  <span className="daily-report-updated">
    Zuletzt bearbeitet am {formatReportDate(report.updatedAt)} um {formatReportTime(report.updatedAt)} Uhr
  </span>
)}
```

Add one action row with three 44px-or-larger touch targets: `PDF`, `Bearbeiten`, `Löschen`. Keep delete visually distinct but not dominant. Add the date input and Tages-PDF control at the top of history.

- [ ] **Step 8: Style for iPhone and desktop without changing the dashboard theme**

In `admin-overview.css`, add focused classes such as:

```css
.daily-report-toolbar { display:flex; gap:10px; align-items:end; flex-wrap:wrap; }
.daily-report-toolbar label { min-width:160px; flex:1 1 180px; }
.daily-report-toolbar input,
.daily-report-entry-actions button { min-height:44px; }
.daily-report-entry-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
.daily-report-entry-actions .danger { border-color:rgba(239,68,68,.42); }
.daily-report-updated { display:block; margin-top:4px; opacity:.72; font-size:.82rem; }
@media (max-width: 520px) {
  .daily-report-toolbar > * { width:100%; }
  .daily-report-entry-actions button { flex:1 1 calc(33.333% - 8px); }
}
```

Use existing variables/colors where available rather than adding a second visual system.

- [ ] **Step 9: Run feature/build verification**

```bash
npm run verify:admin-overview
npm run build:frontend
```

Expected: PASS and generated source still contains the new controls after any apply scripts run.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/AdminOverview.jsx frontend/src/admin-overview.css scripts/admin-overview-daily-report-test.mjs scripts/apply-admin-overview-daily-report.mjs
git commit -m "feat: add daily report management controls"
```

---

### Task 4: Browser-Regressionen, Rollen und vollständige Portal-Prüfung

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `.github/workflows/admin-overview-daily-report-verify.yml`
- Modify: `package.json` only if test scripts need final aggregation

**Interfaces:**
- Consumes: all feature behavior from Tasks 1–3.
- Produces: deployment gate proving desktop/iPhone/Android safety and role restrictions.

- [ ] **Step 1: Add failing browser test routes and report fixtures**

Extend the test route setup with in-memory reports and handlers for:

```js
let dailyReports = [{
  id: 'report-1', text: 'Schicht ohne besondere Vorkommnisse.',
  authorId: 'owner-1', authorName: 'Hauptadmin',
  createdAt: '2026-08-14T16:00:00.000Z',
}]
```

Mock GET date filtering, PATCH text/update metadata, DELETE removal and `/api/daily-reports-pdf**` returning a minimal `%PDF-` body with `application/pdf` and attachment header.

- [ ] **Step 2: Add admin interaction test**

Add one focused scenario that:

1. logs in as owner/admin;
2. opens `Berichte öffnen`;
3. sees the current date filter and one report;
4. edits its text and confirms `Zuletzt bearbeitet` appears;
5. triggers single PDF and confirms a request to `?id=report-1`;
6. triggers Tages-PDF and confirms a request with `?date=...`;
7. clicks delete, accepts the confirmation, and confirms the entry disappears.

- [ ] **Step 3: Add/retain non-admin visibility assertion**

In the existing employee test, explicitly assert:

```js
await expect(page.getByText('Tagesbericht')).toHaveCount(0)
await expect(page.getByText('Tages-PDF herunterladen')).toHaveCount(0)
```

Do not weaken existing employee access tests.

- [ ] **Step 4: Run targeted browser tests**

```bash
npx playwright test tests/e2e/unified-portal.spec.mjs --project=iphone-chromium
```

Expected: PASS.

- [ ] **Step 5: Wire feature tests into CI**

Ensure `.github/workflows/admin-overview-daily-report-verify.yml` executes, in order:

```bash
npm install --no-audit --no-fund
npm run verify:daily-reports
npm run verify:admin-overview
node scripts/daily-report-pdf-test.mjs
npm run build
npm run test:e2e
```

Do not remove existing full-portal verification jobs.

- [ ] **Step 6: Run full verification before merge**

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: every source/domain test passes, build succeeds, and the complete Playwright suite passes on desktop, iPhone and Android.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/unified-portal.spec.mjs .github/workflows/admin-overview-daily-report-verify.yml package.json
git commit -m "test: cover daily report PDF edit and delete flows"
```

---

### Task 5: Final review, merge and production deployment verification

**Files:**
- No feature code should be added in this task unless review finds a concrete defect.

**Interfaces:**
- Consumes: green branch from Tasks 1–4.
- Produces: reviewed `main` merge and verified Netlify production deploy.

- [ ] **Step 1: Review the final diff against the approved spec**

Check these exact invariants:

```text
owner/admin: create + read + edit + delete + single PDF + daily PDF
manager/employee: no UI + server 403
createdAt/author unchanged on edit
updatedAt/updatedBy generated server-side
DELETE resolves id to internal blob key server-side
PDF uses existing centralized logo helper
Europe/Berlin date filtering
single and daily PDF filenames
no recycle bin
no changes to timesheet/attendance/schedule behavior
```

- [ ] **Step 2: Re-run fresh verification from the final head**

```bash
npm run verify && npm run build && npm run test:e2e
```

Expected: exit code 0.

- [ ] **Step 3: Open/finish PR and wait for CI**

PR title:

```text
Tagesbericht: PDF, Bearbeiten und Löschen
```

PR description must state that the feature reuses the existing central logo and that deletion is permanent after confirmation.

- [ ] **Step 4: Merge only after all checks are green**

Merge into `main` only when the feature workflow and full portal workflow both report success.

- [ ] **Step 5: Verify Netlify production deploy**

Confirm the production deploy is `ready`, references the merge commit, and lists both functions:

```text
daily-reports
daily-reports-pdf
```

Then perform a production smoke check with an authenticated admin account: open report history, verify date filtering, download one PDF, and confirm existing attendance/schedule pages still load.
