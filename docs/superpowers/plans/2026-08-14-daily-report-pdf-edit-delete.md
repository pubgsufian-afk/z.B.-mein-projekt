# Tagesbericht PDF, Bearbeiten und Löschen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden Tagesbericht um Bearbeiten, endgültiges Löschen sowie Einzel- und Tages-PDF mit dem vorhandenen Habun-Firmenlogo erweitern.

**Architecture:** `/api/daily-reports` bleibt die JSON-CRUD-Schnittstelle und wird um Datumsfilter, `PATCH` und `DELETE` erweitert. Ein neuer `/api/daily-reports-pdf`-Endpunkt rendert A4-PDFs mit `pdf-lib` und den vorhandenen zentralen Logo-Helfern. `AdminOverview.jsx` bleibt der einzige UI-Einstieg und erhält mobile Verwaltungsaktionen.

**Tech Stack:** React 19, Netlify Functions, `@netlify/blobs`, `@netlify/identity`, `pdf-lib`, Node-Tests, Playwright.

## Global Constraints

- Nur `owner` und `admin` dürfen Tagesberichte lesen, erstellen, bearbeiten, endgültig löschen und als PDF exportieren.
- `manager` und `employee` erhalten serverseitig `403` und sehen keine Tagesbericht-Verwaltung.
- Berichtstext bleibt Pflicht und auf 1.000 Wörter begrenzt.
- Datumsgrenzen verwenden `Europe/Berlin`.
- `id`, `authorId`, `authorName` und `createdAt` bleiben beim Bearbeiten unverändert.
- `updatedAt`, `updatedById`, `updatedByName` werden ausschließlich serverseitig gesetzt.
- Löschen hat keinen Papierkorb; UI verlangt vor dem Request `Bericht wirklich endgültig löschen?`.
- Bestehende Blob-Einträge in `portal-daily-reports` bleiben ohne Migration lesbar.
- PDF verwendet die vorhandenen Helfer `loadOriginalLogo` und `drawCenteredShieldLogo`; kein zweites Logo-System.
- Keine Änderungen an Zeiterfassung, Dienstplan oder bestehenden PDF-/Excel-Berichten.

## File Structure

- Create `netlify/functions/_shared/daily-report-model.mts` — gemeinsamer Typ, Berlin-Datum, Blob-Lookup und Dateinamenbereinigung.
- Modify `netlify/functions/daily-reports.mts` — GET/POST/PATCH/DELETE.
- Create `netlify/functions/daily-reports-pdf.mts` — Einzel-/Tages-PDF.
- Modify `frontend/src/AdminOverview.jsx` — Filter, PDF, Bearbeiten, Löschen.
- Modify `frontend/src/admin-overview.css` — mobile Aktionsflächen.
- Modify `scripts/admin-overview-daily-report-test.mjs` — UI-Source-Contract.
- Create `scripts/daily-report-crud-test.mjs` and `scripts/daily-report-pdf-test.mjs` — Backend/PDF-Verträge.
- Modify `tests/e2e/unified-portal.spec.mjs` — Browserablauf.
- Modify `package.json` and `.github/workflows/admin-overview-daily-report-verify.yml` — Verifikations-Gates.

---

### Task 1: CRUD-Modell, Datumsfilter, Bearbeiten und endgültiges Löschen

**Files:**
- Create: `netlify/functions/_shared/daily-report-model.mts`
- Create: `scripts/daily-report-crud-test.mjs`
- Modify: `netlify/functions/daily-reports.mts`
- Modify: `package.json`

**Interfaces:**
- Produces `DailyReport`, `BERLIN_TIME_ZONE`, `reportStore()`, `isIsoDateKey()`, `berlinDateKey()`, `listDailyReports()`, `findDailyReportById()`, `safePdfFilenamePart()`.
- Later tasks import exactly those names.

- [ ] **Step 1: Write the failing CRUD contract test**

Create `scripts/daily-report-crud-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BERLIN_TIME_ZONE, berlinDateKey, isIsoDateKey, safePdfFilenamePart,
} from '../netlify/functions/_shared/daily-report-model.mts'

assert.equal(BERLIN_TIME_ZONE, 'Europe/Berlin')
assert.equal(isIsoDateKey('2026-08-14'), true)
assert.equal(isIsoDateKey('14.08.2026'), false)
assert.equal(berlinDateKey('2026-08-14T22:30:00.000Z'), '2026-08-15')
assert.equal(safePdfFilenamePart('Ädmin / Test'), 'Admin-Test')

const source = readFileSync(new URL('../netlify/functions/daily-reports.mts', import.meta.url), 'utf8')
for (const token of ['PATCH', 'DELETE', 'updatedAt', 'updatedById', 'updatedByName']) assert.match(source, new RegExp(token))
assert.match(source, /verifyRequestOrigin/)
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/)
console.log('daily report CRUD contract: ok')
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types scripts/daily-report-crud-test.mjs
```

Expected: FAIL because `_shared/daily-report-model.mts` does not exist.

- [ ] **Step 3: Implement the shared model**

Create `netlify/functions/_shared/daily-report-model.mts`:

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
  return String(value || 'Admin').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Admin'
}

export async function listDailyReports(store = reportStore(), date?: string) {
  const listed = await store.list({ prefix: 'reports/' })
  const rows = await Promise.all(listed.blobs.map(async (blob) => ({
    key: blob.key,
    report: await store.get(blob.key, { type: 'json' }) as DailyReport | null,
  })))
  return rows
    .filter((row): row is { key: string; report: DailyReport } => Boolean(row.report?.id && row.report?.createdAt && row.report?.text))
    .filter((row) => !date || berlinDateKey(row.report.createdAt) === date)
    .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt))
}

export async function findDailyReportById(store = reportStore(), id: string) {
  if (!id) return null
  return (await listDailyReports(store)).find((row) => row.report.id === id) || null
}
```

- [ ] **Step 4: Extend `/api/daily-reports`**

Keep current POST behavior and `validateDailyReportText`. Change allowed methods to `GET`, `POST`, `PATCH`, `DELETE`. GET validates optional `date` and returns `listDailyReports(..., date)` without internal keys.

PATCH must use this shape after `verifyRequestOrigin(request)`:

```ts
const id = new URL(request.url).searchParams.get('id') || ''
const found = await findDailyReportById(store, id)
if (!found) return response({ message: 'Bericht nicht gefunden.' }, 404)
const body = await request.json().catch(() => null) as Record<string, unknown> | null
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

DELETE must perform origin verification, resolve only the public `id`, call `await store.delete(found.key)`, and return:

```ts
return response({ deleted: true, id })
```

Never accept an internal blob key from the browser.

- [ ] **Step 5: Wire and run targeted tests**

Add to `package.json`:

```json
"verify:daily-reports": "node --experimental-strip-types scripts/daily-report-crud-test.mjs"
```

Run:

```bash
npm run verify:daily-reports
npm run verify:admin-overview
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/daily-report-model.mts netlify/functions/daily-reports.mts scripts/daily-report-crud-test.mjs package.json
git commit -m "feat: add daily report editing and deletion API"
```

---

### Task 2: Branded Einzel- und Tages-PDF

**Files:**
- Create: `netlify/functions/daily-reports-pdf.mts`
- Create: `scripts/daily-report-pdf-test.mjs`
- Reuse: `netlify/functions/_shared/pdf-shield-logo.mts`

**Interfaces:**
- GET `/api/daily-reports-pdf?id=<report-id>` returns one report.
- GET `/api/daily-reports-pdf?date=YYYY-MM-DD` returns all reports of that Berlin day, oldest first.

- [ ] **Step 1: Write the failing PDF source test**

Create `scripts/daily-report-pdf-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../netlify/functions/daily-reports-pdf.mts', import.meta.url), 'utf8')
for (const token of ['PDFDocument', 'StandardFonts', 'loadOriginalLogo', 'drawCenteredShieldLogo', 'Content-Disposition', 'Tagesbericht', 'Seite']) assert.match(source, new RegExp(token))
assert.match(source, /application\/pdf/)
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/)
console.log('daily report PDF source contract: ok')
```

- [ ] **Step 2: Run RED**

```bash
node scripts/daily-report-pdf-test.mjs
```

Expected: FAIL because the PDF function does not exist.

- [ ] **Step 3: Implement request selection and authorization**

Create `netlify/functions/daily-reports-pdf.mts` with imports:

```ts
import type { Config } from '@netlify/functions'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { requirePortalRole } from './_shared/portal-role.mts'
import { drawCenteredShieldLogo, loadOriginalLogo } from './_shared/pdf-shield-logo.mts'
import {
  berlinDateKey, findDailyReportById, isIsoDateKey, listDailyReports,
  reportStore, safePdfFilenamePart, type DailyReport,
} from './_shared/daily-report-model.mts'
```

The handler must reject non-GET with 405, require `owner/admin`, and require exactly one selector:

```ts
const url = new URL(request.url)
const id = url.searchParams.get('id') || ''
const date = url.searchParams.get('date') || ''
if ((!id && !date) || (id && date)) return jsonError('Bericht-ID oder Datum angeben.', 400)
if (date && !isIsoDateKey(date)) return jsonError('Ungültiges Datum.', 400)

let reports: DailyReport[]
if (id) {
  const found = await findDailyReportById(reportStore(), id)
  if (!found) return jsonError('Bericht nicht gefunden.', 404)
  reports = [found.report]
} else {
  reports = (await listDailyReports(reportStore(), date)).map(({ report }) => report)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (!reports.length) return jsonError('Für diesen Tag sind keine Berichte vorhanden.', 404)
}
```

- [ ] **Step 4: Implement exact A4 renderer**

Use `[595.28, 841.89]`, 48pt margins, Helvetica, Helvetica-Bold, 10.5pt body, 15pt line height. Add this word-wrapper:

```ts
function wrapText(text: string, font: { widthOfTextAtSize(text: string, size: number): number }, size: number, maxWidth: number) {
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

Create each page with the centered existing logo using `loadOriginalLogo(pdf)` plus `drawCenteredShieldLogo(...)`. Draw `Habun Security`, title `Tagesbericht` for single export or `Tagesberichte` for day export, then date and report sections. Each section draws author, creation date/time, optional `Zuletzt bearbeitet ...`, then every wrapped text line. Before drawing a line, if the cursor would cross 64pt, add a new A4 page, redraw the compact document header, and continue the same report without truncation.

After rendering all content:

```ts
const pages = pdf.getPages()
pages.forEach((page, index) => {
  const label = `Seite ${index + 1} von ${pages.length}`
  page.drawText(label, {
    x: Math.max(24, (page.getWidth() - regular.widthOfTextAtSize(label, 8)) / 2),
    y: 24, size: 8, font: regular, color: rgb(0.35, 0.35, 0.35),
  })
})
```

- [ ] **Step 5: Return download response and filenames**

Single filename:

```ts
const fileDate = berlinDateKey(reports[0].createdAt)
const filename = `Tagesbericht_${fileDate}_${safePdfFilenamePart(reports[0].authorName)}.pdf`
```

Daily filename:

```ts
const filename = `Tagesberichte_${date}.pdf`
```

Response:

```ts
return new Response(await pdf.save(), {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  },
})
```

Finish with:

```ts
export const config: Config = { path: '/api/daily-reports-pdf' }
```

- [ ] **Step 6: Run PDF and branding tests**

```bash
node scripts/daily-report-pdf-test.mjs
node scripts/pdf-branding-test.mjs
node scripts/final-export-logo-test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/daily-reports-pdf.mts scripts/daily-report-pdf-test.mjs
git commit -m "feat: add branded daily report PDF exports"
```

---

### Task 3: Mobile Admin-Berichtsverwaltung

**Files:**
- Modify: `frontend/src/AdminOverview.jsx`
- Modify: `frontend/src/admin-overview.css`
- Modify: `scripts/admin-overview-daily-report-test.mjs`
- Modify: `scripts/apply-admin-overview-daily-report.mjs` if it rewrites these sources during build.

**Interfaces:**
- Consumes CRUD and PDF endpoints from Tasks 1–2.
- Produces date filter, `Tages-PDF herunterladen`, per-entry `PDF`, `Bearbeiten`, `Löschen`, and visible edit timestamp.

- [ ] **Step 1: Extend the existing source contract before UI code**

Add assertions for:

```js
assert.match(overviewSource, /Tages-PDF herunterladen/)
assert.match(overviewSource, /Bearbeiten/)
assert.match(overviewSource, /Löschen/)
assert.match(overviewSource, /Zuletzt bearbeitet/)
assert.match(overviewSource, /daily-reports-pdf/)
assert.match(overviewSource, /method: 'PATCH'/)
assert.match(overviewSource, /method: 'DELETE'/)
assert.match(overviewSource, /Bericht wirklich endgültig löschen\?/)
assert.match(overviewSource, /type="date"/)
```

Run `npm run verify:admin-overview`; expected RED.

- [ ] **Step 2: Add filtered history state and loading**

Add:

```js
const [reportDate, setReportDate] = useState(today)
const [editingReport, setEditingReport] = useState(null)
const [reportBusyId, setReportBusyId] = useState('')
```

History load must call:

```js
const data = await apiJson(`/api/daily-reports?date=${encodeURIComponent(reportDate)}`)
```

Changing the date input updates `reportDate` and reloads that date.

- [ ] **Step 3: Reuse compose dialog for edit**

Edit action sets the selected report plus its existing text. Save selects POST/PATCH exactly as follows:

```js
const path = editingReport ? `/api/daily-reports?id=${encodeURIComponent(editingReport.id)}` : '/api/daily-reports'
const method = editingReport ? 'PATCH' : 'POST'
await apiJson(path, { method, body: JSON.stringify({ text: reportText }) })
```

After success, clear edit/text state and reload the selected day. Keep the existing 1,000-word counter and validation.

- [ ] **Step 4: Add permanent delete confirmation**

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

- [ ] **Step 5: Add authenticated PDF download helper**

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
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = matched?.[1] || fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}
```

Single report calls `/api/daily-reports-pdf?id=...`; day export calls `/api/daily-reports-pdf?date=...`. Disable the day button when the filtered list is empty.

- [ ] **Step 6: Render actions and edit metadata**

Each report entry adds:

```jsx
{report.updatedAt && (
  <span className="daily-report-updated">
    Zuletzt bearbeitet am {formatReportDate(report.updatedAt)} um {formatReportTime(report.updatedAt)} Uhr
  </span>
)}
<div className="daily-report-entry-actions">
  <button type="button">PDF</button>
  <button type="button">Bearbeiten</button>
  <button type="button" className="danger">Löschen</button>
</div>
```

Above the list add a `type="date"` input and `Tages-PDF herunterladen` button.

- [ ] **Step 7: Add mobile CSS**

```css
.daily-report-toolbar { display:flex; gap:10px; align-items:end; flex-wrap:wrap; }
.daily-report-toolbar input,
.daily-report-entry-actions button { min-height:44px; }
.daily-report-entry-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
.daily-report-entry-actions .danger { border-color:rgba(239,68,68,.42); }
.daily-report-updated { display:block; margin-top:4px; opacity:.72; font-size:.82rem; }
@media (max-width:520px) {
  .daily-report-toolbar > * { width:100%; }
  .daily-report-entry-actions button { flex:1 1 calc(33.333% - 8px); }
}
```

Use existing portal variables/colors for backgrounds, text and gold accents.

- [ ] **Step 8: Verify generated source is not reverted**

Run:

```bash
npm run verify:admin-overview
npm run build:frontend
npm run verify:admin-overview
```

Expected: all PASS. If the second verification loses the feature, update `scripts/apply-admin-overview-daily-report.mjs` to emit the new canonical `AdminOverview.jsx` and CSS, then rerun the three commands.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/AdminOverview.jsx frontend/src/admin-overview.css scripts/admin-overview-daily-report-test.mjs scripts/apply-admin-overview-daily-report.mjs
git commit -m "feat: add daily report management controls"
```

---

### Task 4: E2E, CI, merge and production verification

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `.github/workflows/admin-overview-daily-report-verify.yml`
- Modify: `package.json` only if aggregation needs adjustment.

**Interfaces:**
- Produces final regression gate across desktop, iPhone and Android.

- [ ] **Step 1: Add browser fixture and failing admin scenario**

Use an in-memory report fixture:

```js
let dailyReports = [{
  id: 'report-1', text: 'Schicht ohne besondere Vorkommnisse.',
  authorId: 'owner-1', authorName: 'Hauptadmin',
  createdAt: '2026-08-14T16:00:00.000Z',
}]
```

Mock `GET /api/daily-reports?date=...`, PATCH, DELETE, and `/api/daily-reports-pdf**`. PDF mock must return `%PDF-1.7` bytes, `Content-Type: application/pdf`, and `Content-Disposition: attachment; filename="Tagesbericht_Test.pdf"`.

The admin test must open history, change/edit text, verify `Zuletzt bearbeitet`, trigger single-PDF and day-PDF requests, confirm delete, and verify the entry disappears.

- [ ] **Step 2: Assert non-admin hiding**

Keep existing employee access tests and add:

```js
await expect(page.getByText('Tagesbericht')).toHaveCount(0)
await expect(page.getByText('Tages-PDF herunterladen')).toHaveCount(0)
```

- [ ] **Step 3: Run targeted iPhone E2E**

```bash
npx playwright test tests/e2e/unified-portal.spec.mjs --project=iphone-chromium
```

Expected: PASS.

- [ ] **Step 4: Wire feature tests into CI**

Ensure the feature workflow executes:

```bash
npm install --no-audit --no-fund
npm run verify:daily-reports
npm run verify:admin-overview
node scripts/daily-report-pdf-test.mjs
npm run build
npm run test:e2e
```

Do not remove the existing full-portal workflow.

- [ ] **Step 5: Run the complete local/CI-equivalent gate**

```bash
npm run verify
npm run verify:daily-reports
node scripts/daily-report-pdf-test.mjs
npm run build
npm run test:e2e
```

Expected: exit code 0; the complete Playwright suite passes for desktop, iPhone and Android.

- [ ] **Step 6: Review exact invariants before merge**

Confirm all are true:

```text
owner/admin: create + read + edit + delete + single PDF + daily PDF
manager/employee: hidden UI + API 403
createdAt/author immutable on edit
updated metadata server-generated
DELETE accepts public id, never blob key
Europe/Berlin filter
existing central PDF logo used
single PDF and daily PDF filenames correct
no recycle bin
attendance/schedule/timesheet behavior unchanged
```

- [ ] **Step 7: Commit test changes**

```bash
git add tests/e2e/unified-portal.spec.mjs .github/workflows/admin-overview-daily-report-verify.yml package.json
git commit -m "test: cover daily report PDF edit and delete flows"
```

- [ ] **Step 8: Merge only after green CI and verify Netlify production**

PR title: `Tagesbericht: PDF, Bearbeiten und Löschen`.

After both feature and full-portal workflows are green, merge to `main`. Verify the Netlify production deploy is `ready`, points to that merge commit, and lists both `daily-reports` and `daily-reports-pdf`. Smoke-check as authenticated admin: date filter opens, one PDF downloads, Tages-PDF downloads, edit metadata appears, delete confirmation works, and existing Zeiterfassung/Dienstplan pages still load.
