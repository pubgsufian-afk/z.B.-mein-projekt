# Tagesbericht PDF, Bearbeiten und Löschen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bestehenden Admin-Tagesbericht um Bearbeiten, endgültiges Löschen sowie Einzel- und Tages-PDF mit dem vorhandenen Firmenlogo erweitern.

**Architecture:** `/api/daily-reports` bleibt die JSON-CRUD-Schnittstelle. Ein gemeinsames Tagesbericht-Modul kapselt Berlin-Datum, Blob-Lookup und Dateinamen. `/api/daily-reports-pdf` rendert ausschließlich PDFs mit `pdf-lib` und der vorhandenen zentralen Logo-Funktion. `AdminOverview.jsx` erhält nur die neue Verwaltung, ohne Zeiterfassung, Dienstplan oder bestehende Reports zu verändern.

**Tech Stack:** React 19, Netlify Functions, `@netlify/blobs`, `@netlify/identity`, `pdf-lib`, Node-Tests, Playwright.

## Global Constraints

- Nur `owner` und `admin`: lesen, schreiben, bearbeiten, endgültig löschen, Einzel-PDF, Tages-PDF.
- `manager` und `employee`: UI verborgen und API `403`.
- Textpflicht, maximal 1.000 Wörter.
- Tagesgrenzen und Filter: `Europe/Berlin`.
- Beim Bearbeiten unverändert: `id`, `authorId`, `authorName`, `createdAt`.
- Nur Server setzt: `updatedAt`, `updatedById`, `updatedByName`.
- Löschen endgültig nach `Bericht wirklich endgültig löschen?`; kein Papierkorb.
- Bestehende `portal-daily-reports`-Blobs bleiben ohne Migration lesbar.
- PDFs verwenden `loadOriginalLogo` und `drawCenteredShieldLogo`; kein neues Logo-System.
- Keine KI, Anhänge, Fotos oder Autosave.

## File Structure

- Create `netlify/functions/_shared/daily-report-model.mts` — Typ, Berlin-Datum, Store-Lookup, Dateinamen.
- Modify `netlify/functions/daily-reports.mts` — GET/POST/PATCH/DELETE.
- Create `netlify/functions/daily-reports-pdf.mts` — A4 Einzel-/Tages-PDF.
- Modify `frontend/src/AdminOverview.jsx` and `frontend/src/admin-overview.css` — Filter/Aktionen.
- Create `scripts/daily-report-crud-test.mjs`, `scripts/daily-report-pdf-test.mjs`.
- Modify `scripts/admin-overview-daily-report-test.mjs`, `tests/e2e/unified-portal.spec.mjs`, `package.json`, `.github/workflows/admin-overview-daily-report-verify.yml`.

---

### Task 1: Gemeinsames Modell und CRUD

**Files:**
- Create: `netlify/functions/_shared/daily-report-model.mts`
- Create: `scripts/daily-report-crud-test.mjs`
- Modify: `netlify/functions/daily-reports.mts`
- Modify: `package.json`

**Interfaces:** Produces `DailyReport`, `BERLIN_TIME_ZONE`, `reportStore`, `isIsoDateKey`, `berlinDateKey`, `listDailyReports`, `findDailyReportById`, `safePdfFilenamePart`.

- [ ] **Step 1: Write failing test**

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BERLIN_TIME_ZONE, berlinDateKey, isIsoDateKey, safePdfFilenamePart } from '../netlify/functions/_shared/daily-report-model.mts'
assert.equal(BERLIN_TIME_ZONE, 'Europe/Berlin')
assert.equal(isIsoDateKey('2026-08-14'), true)
assert.equal(isIsoDateKey('2026-02-30'), false)
assert.equal(isIsoDateKey('14.08.2026'), false)
assert.equal(berlinDateKey('2026-08-14T22:30:00.000Z'), '2026-08-15')
assert.equal(safePdfFilenamePart('Ädmin / Test'), 'Admin-Test')
const source = readFileSync(new URL('../netlify/functions/daily-reports.mts', import.meta.url), 'utf8')
for (const token of ['PATCH','DELETE','updatedAt','updatedById','updatedByName']) assert.match(source, new RegExp(token))
assert.match(source, /verifyRequestOrigin/)
assert.match(source, /requirePortalRole\(\['owner', 'admin'\]\)/)
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types scripts/daily-report-crud-test.mjs
```

Expected: FAIL because the shared module does not exist.

- [ ] **Step 3: Implement shared model**

```ts
import { getStore } from '@netlify/blobs'
export const BERLIN_TIME_ZONE = 'Europe/Berlin'
export const DAILY_REPORT_STORE = 'portal-daily-reports'
export type DailyReport = {
  id:string; text:string; authorId:string; authorName:string; createdAt:string
  updatedAt?:string; updatedById?:string; updatedByName?:string
}
export function reportStore() { return getStore({ name: DAILY_REPORT_STORE, consistency: 'strong' }) }
export function isIsoDateKey(value: unknown): value is string {
  const text = String(value || '')
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const [, y, m, d] = match
  const probe = new Date(`${y}-${m}-${d}T12:00:00.000Z`)
  return Number.isFinite(probe.getTime())
    && probe.getUTCFullYear() === Number(y)
    && probe.getUTCMonth() + 1 === Number(m)
    && probe.getUTCDate() === Number(d)
}
export function berlinDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date)
  const pick = (type:string) => parts.find((part) => part.type === type)?.value || ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}
export function safePdfFilenamePart(value: unknown) {
  return String(value || 'Admin').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'Admin'
}
export async function listDailyReports(store = reportStore(), date?: string) {
  const listed = await store.list({ prefix:'reports/' })
  const rows = await Promise.all(listed.blobs.map(async (blob) => ({ key:blob.key, report:await store.get(blob.key,{ type:'json' }) as DailyReport | null })))
  return rows.filter((row): row is { key:string; report:DailyReport } => Boolean(row.report?.id && row.report?.createdAt && row.report?.text))
    .filter((row) => !date || berlinDateKey(row.report.createdAt) === date)
    .sort((a,b) => b.report.createdAt.localeCompare(a.report.createdAt))
}
export async function findDailyReportById(store = reportStore(), id:string) {
  if (!id) return null
  return (await listDailyReports(store)).find((row) => row.report.id === id) || null
}
```

- [ ] **Step 4: Extend JSON API**

Allow only `GET`, `POST`, `PATCH`, `DELETE`; keep current POST validation/metadata. GET validates optional `date` with `isIsoDateKey` and returns reports without blob keys. For PATCH/DELETE call `verifyRequestOrigin(request)` first, then resolve only `?id=` with `findDailyReportById`.

PATCH implementation core:

```ts
const found = await findDailyReportById(store, id)
if (!found) return response({ message:'Bericht nicht gefunden.' }, 404)
const body = await request.json().catch(() => null) as Record<string,unknown> | null
const validation = validateDailyReportText(body?.text)
if (!validation.ok) return response({ message:validation.message }, validation.status)
const updated: DailyReport = {
  ...found.report,
  text: validation.text,
  updatedAt: new Date().toISOString(),
  updatedById: current.userId,
  updatedByName: await authorNameFor(current),
}
await store.setJSON(found.key, updated)
return response({ report:updated })
```

DELETE implementation core:

```ts
const found = await findDailyReportById(store, id)
if (!found) return response({ message:'Bericht nicht gefunden.' }, 404)
await store.delete(found.key)
return response({ deleted:true, id })
```

- [ ] **Step 5: Wire/run tests**

Add:

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

### Task 2: Professionelle PDF-Exporte

**Files:**
- Create: `netlify/functions/daily-reports-pdf.mts`
- Create: `scripts/daily-report-pdf-test.mjs`

**Interfaces:** GET `?id=<id>` returns one PDF; GET `?date=YYYY-MM-DD` returns all reports that Berlin day oldest-first.

- [ ] **Step 1: Write failing PDF test**

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../netlify/functions/daily-reports-pdf.mts', import.meta.url), 'utf8')
for (const token of ['PDFDocument','StandardFonts','loadOriginalLogo','drawCenteredShieldLogo','Content-Disposition','Tagesbericht','Seite']) assert.match(source,new RegExp(token))
assert.match(source,/application\/pdf/)
assert.match(source,/requirePortalRole\(\['owner', 'admin'\]\)/)
```

Run `node scripts/daily-report-pdf-test.mjs`; expected RED.

- [ ] **Step 2: Implement authorization and report selection**

Import `PDFDocument`, `StandardFonts`, `rgb`, `requirePortalRole`, existing logo helpers and Task-1 helpers. Handler accepts only GET, requires `owner/admin`, and requires exactly one of `id` or `date`:

```ts
const url = new URL(request.url)
const id = url.searchParams.get('id') || ''
const date = url.searchParams.get('date') || ''
if ((!id && !date) || (id && date)) return jsonError('Bericht-ID oder Datum angeben.',400)
if (date && !isIsoDateKey(date)) return jsonError('Ungültiges Datum.',400)
let reports: DailyReport[] = []
if (id) {
  const found = await findDailyReportById(reportStore(),id)
  if (!found) return jsonError('Bericht nicht gefunden.',404)
  reports = [found.report]
} else {
  reports = (await listDailyReports(reportStore(),date)).map(({report}) => report).sort((a,b) => a.createdAt.localeCompare(b.createdAt))
  if (!reports.length) return jsonError('Für diesen Tag sind keine Berichte vorhanden.',404)
}
```

- [ ] **Step 3: Implement complete A4 renderer**

Use A4 `[595.28,841.89]`, 48pt side margins, bottom content limit 64pt, Helvetica/Helvetica-Bold, 10.5pt body, 15pt line-height. Implement word-wrap:

```ts
function wrapText(text:string,font:{widthOfTextAtSize(text:string,size:number):number},size:number,maxWidth:number) {
  const lines:string[] = []
  for (const paragraph of String(text).split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate,size) <= maxWidth) line = candidate
      else { if (line) lines.push(line); line = word }
    }
    if (line) lines.push(line)
    if (!words.length) lines.push('')
  }
  return lines
}
```

Create the PDF with `PDFDocument.create()`, embed Helvetica fonts, load the current central logo via `loadOriginalLogo(pdf)`, and use `drawCenteredShieldLogo` on the first page. Render company title + `Tagesbericht`/`Tagesberichte`, date, then every report with author, creation time, optional edit time and full wrapped text. If the next line would cross 64pt, add a page and continue the same text; do not truncate. After content, add centered `Seite X von Y` at y=24 on every page.

- [ ] **Step 4: Return exact filenames/headers**

Single: `Tagesbericht_${berlinDateKey(reports[0].createdAt)}_${safePdfFilenamePart(reports[0].authorName)}.pdf`.

Day: `Tagesberichte_${date}.pdf`.

```ts
return new Response(await pdf.save(), { headers:{
  'Content-Type':'application/pdf',
  'Content-Disposition':`attachment; filename="${filename}"`,
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex',
} })
export const config: Config = { path:'/api/daily-reports-pdf' }
```

- [ ] **Step 5: Run/commit**

```bash
node scripts/daily-report-pdf-test.mjs
node scripts/pdf-branding-test.mjs
node scripts/final-export-logo-test.mjs
git add netlify/functions/daily-reports-pdf.mts scripts/daily-report-pdf-test.mjs
git commit -m "feat: add branded daily report PDF exports"
```

Expected: all tests PASS.

---

### Task 3: Mobile UI für Filter, PDF, Bearbeiten und Löschen

**Files:**
- Modify: `frontend/src/AdminOverview.jsx`
- Modify: `frontend/src/admin-overview.css`
- Modify: `scripts/admin-overview-daily-report-test.mjs`
- Modify: `scripts/apply-admin-overview-daily-report.mjs` only when the build script proves it rewrites the canonical files.

**Interfaces:** Consumes Tasks 1–2 endpoints.

- [ ] **Step 1: Extend source-contract first**

Add assertions for `Tages-PDF herunterladen`, `Bearbeiten`, `Löschen`, `Zuletzt bearbeitet`, `daily-reports-pdf`, `method: 'PATCH'`, `method: 'DELETE'`, `Bericht wirklich endgültig löschen?`, and `type="date"`. Run `npm run verify:admin-overview`; expected RED.

- [ ] **Step 2: Add state/filter**

```js
const [reportDate,setReportDate] = useState(today)
const [editingReport,setEditingReport] = useState(null)
const [reportBusyId,setReportBusyId] = useState('')
```

History request is exactly `/api/daily-reports?date=${encodeURIComponent(reportDate)}` and reloads on chosen date.

- [ ] **Step 3: Reuse compose dialog for edit**

Preload selected report text. Save chooses:

```js
const path = editingReport ? `/api/daily-reports?id=${encodeURIComponent(editingReport.id)}` : '/api/daily-reports'
const method = editingReport ? 'PATCH' : 'POST'
await apiJson(path,{ method,body:JSON.stringify({ text:reportText }) })
```

After success clear editing/text and reload selected date.

- [ ] **Step 4: Add permanent delete**

```js
if (!window.confirm('Bericht wirklich endgültig löschen?')) return
await apiJson(`/api/daily-reports?id=${encodeURIComponent(report.id)}`,{ method:'DELETE' })
await loadReportsForDate(reportDate)
```

- [ ] **Step 5: Add authenticated PDF download**

```js
async function downloadPdf(path,fallbackName) {
  const response = await fetch(path,{ credentials:'same-origin',cache:'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.message || 'Die PDF konnte nicht erstellt werden.')
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const matched = disposition.match(/filename="?([^";]+)"?/i)
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = matched?.[1] || fallbackName
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href)
}
```

Entry PDF uses `?id=`; top Tages-PDF uses `?date=` and is disabled when no filtered reports exist.

- [ ] **Step 6: Render edit metadata/actions and mobile CSS**

Render `Zuletzt bearbeitet am {date} um {time} Uhr` when `updatedAt` exists. Add 44px+ buttons `PDF`, `Bearbeiten`, `Löschen`; delete is visually distinct. Add date input and Tages-PDF toolbar.

Required CSS baseline:

```css
.daily-report-toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap}
.daily-report-toolbar input,.daily-report-entry-actions button{min-height:44px}
.daily-report-entry-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.daily-report-entry-actions .danger{border-color:rgba(239,68,68,.42)}
.daily-report-updated{display:block;margin-top:4px;opacity:.72;font-size:.82rem}
@media(max-width:520px){.daily-report-toolbar>*{width:100%}.daily-report-entry-actions button{flex:1 1 calc(33.333% - 8px)}}
```

- [ ] **Step 7: Verify build does not revert source**

```bash
npm run verify:admin-overview
npm run build:frontend
npm run verify:admin-overview
```

If the last command fails because `scripts/apply-admin-overview-daily-report.mjs` restored older canonical source, update that script to emit the same reviewed JSX/CSS, then rerun these three commands until all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/AdminOverview.jsx frontend/src/admin-overview.css scripts/admin-overview-daily-report-test.mjs scripts/apply-admin-overview-daily-report.mjs
git commit -m "feat: add daily report management controls"
```

---

### Task 4: Browser, CI, merge and production gate

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `.github/workflows/admin-overview-daily-report-verify.yml`
- Modify: `package.json` if aggregation requires it.

- [ ] **Step 1: Add failing E2E fixture**

Use in-memory report:

```js
let dailyReports=[{id:'report-1',text:'Schicht ohne besondere Vorkommnisse.',authorId:'owner-1',authorName:'Hauptadmin',createdAt:'2026-08-14T16:00:00.000Z'}]
```

Mock filtered GET, PATCH with server-style update metadata, DELETE, and PDF route returning `%PDF-1.7`, `application/pdf`, attachment filename.

- [ ] **Step 2: Add admin browser scenario**

Owner/admin opens history, filters date, edits text, sees `Zuletzt bearbeitet`, triggers `?id=report-1` PDF, triggers date PDF, confirms permanent deletion, sees entry disappear.

- [ ] **Step 3: Add non-admin assertions**

```js
await expect(page.getByText('Tagesbericht')).toHaveCount(0)
await expect(page.getByText('Tages-PDF herunterladen')).toHaveCount(0)
```

Retain all existing employee policy assertions.

- [ ] **Step 4: Run iPhone then full gates**

```bash
npx playwright test tests/e2e/unified-portal.spec.mjs --project=iphone-chromium
npm run verify
npm run verify:daily-reports
node scripts/daily-report-pdf-test.mjs
npm run build
npm run test:e2e
```

Expected: exit code 0; complete Playwright suite green on desktop, iPhone and Android.

- [ ] **Step 5: CI workflow**

Feature workflow must execute `npm run verify:daily-reports`, `npm run verify:admin-overview`, `node scripts/daily-report-pdf-test.mjs`, `npm run build`, `npm run test:e2e`. Existing full-portal workflow remains enabled.

- [ ] **Step 6: Final invariant review**

```text
owner/admin = create/read/edit/delete/single-PDF/day-PDF
manager/employee = hidden + API 403
original author/createdAt preserved
updated metadata server-only
invalid calendar dates = 400
DELETE accepts id, never blob key
Europe/Berlin filtering
existing central logo
permanent delete, no recycle bin
attendance/schedule/timesheet unchanged
```

- [ ] **Step 7: Commit test changes**

```bash
git add tests/e2e/unified-portal.spec.mjs .github/workflows/admin-overview-daily-report-verify.yml package.json
git commit -m "test: cover daily report PDF edit and delete flows"
```

- [ ] **Step 8: Merge/deploy verification**

Open PR `Tagesbericht: PDF, Bearbeiten und Löschen`. Merge only when feature and full portal checks are green. Confirm Netlify production deploy is `ready`, points to the merge commit, and includes functions `daily-reports` and `daily-reports-pdf`. Smoke-check authenticated admin PDF/edit/delete plus existing Zeiterfassung and Dienstplan.
