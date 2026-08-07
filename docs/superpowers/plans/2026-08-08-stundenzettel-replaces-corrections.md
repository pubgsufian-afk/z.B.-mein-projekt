# Stundenzettel statt Korrekturen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den bisherigen Bereich „Korrekturen“ durch einen zentralen „Stundenzettel“-Bereich ersetzen, in dem tatsächliche Arbeitszeiten bearbeitbar sind und geplante Dienstplanstunden getrennt angezeigt und exportiert werden.

**Architecture:** Die bestehende React-Oberfläche nutzt weiterhin `/api/attendance` für Ist-Zeiten, `/api/schedule-v2` für geplante Schichten und `/api/registrations` für die Mitarbeiterauswahl. Direkte Änderungen und manuelle Nachträge laufen über die bestehende `/api/attendance-time-edit`-Funktion, die um einen sicheren Create-Pfad erweitert wird; Exporte laufen weiterhin über `/api/unified-reports`, aber mit einer expliziten Trennung `actual`/`planned`. Die bisherige DOM-Nachrüstung `admin-time-editing.js` wird durch eine echte React-Editoroberfläche ersetzt.

**Tech Stack:** React/Vite, Netlify Functions (TypeScript/MTS), Netlify Identity, Neon/PostgreSQL, pdf-lib, ExcelJS, Node-basierte Regressionstests und Playwright-E2E.

## Global Constraints

- Der Menüpunkt „Korrekturen“ und die Seite „Korrektur beantragen“ entfallen vollständig.
- Das bestehende Habun-Security-Logo, Farbschema und die mobile Gestaltung bleiben unverändert.
- Tatsächliche Arbeitszeiten und geplante Dienstplanstunden dürfen weder in der Anzeige noch in der Speicherung miteinander vermischt werden.
- Hauptadmin, Admin und Einsatzleiter dürfen tatsächliche Stundenzettel bearbeiten und fehlende Tage nachtragen.
- Mitarbeiter sehen ausschließlich ihre eigenen tatsächlichen und geplanten Zeiten; sie bearbeiten keine Zeiten anderer Mitarbeiter und erhalten keine Gesamtauswertung über andere Mitarbeiter.
- Arbeitsbeginn, Arbeitsende und Pause sind editierbar; Netto-/Gesamtstunden werden immer neu berechnet und nicht als frei editierbarer Zahlenwert gespeichert.
- Die bisherige Begründungs-/Korrekturantragsoberfläche wird nicht in den Stundenzettel übernommen. Audit-Einträge erhalten serverseitig eine neutrale Systembezeichnung, wenn die neue Oberfläche keine freie Begründung mitsendet.
- Unvollständige Dienste werden als offen/unvollständig markiert und nicht mit erfundenen Stunden abgeschlossen.
- PDF und Excel müssen für tatsächliche Arbeitszeiten und geplante Dienstplanstunden getrennte Dokumente erzeugen.
- Zeitraum- und Mitarbeiterauswahl müssen bei Anzeige und Export identisch wirken.
- Bestehende Zeiterfassung, Standortprüfung, Dienstplan und Rollenlogik dürfen durch diese Änderung nicht beschädigt werden.

---

## File Structure

**Create**
- `frontend/src/timesheet-utils.js` — reine Hilfsfunktionen für Ist-Sitzungen, geplante Schichten, Übernacht-Schichten und Summen.
- `scripts/timesheet-page-test.mjs` — Quell-/Vertragsregression für Navigation, Trennung und React-Editor.
- `scripts/timesheet-report-scope-test.mjs` — Regression für getrennte Export-Scope-Verarbeitung.
- `scripts/timesheet-create-test.mjs` — Regression für manuelles Anlegen und Rechte/Audit.
- `tests/e2e/timesheet-page.spec.mjs` — Browserprüfung für mobile Stundenzetteloberfläche.

**Modify**
- `frontend/src/App.jsx` — Navigation, neuer `TimesheetPage`, echte Editor-/Nachtrag-Formulare, getrennte Ist-/Planbereiche und Exportaktionen.
- `frontend/src/styles.css` — responsive Karten, Editor, Summen und Exportaktionen im bestehenden Design.
- `frontend/src/main.jsx` — alte DOM-Nachrüstung für Zeitbearbeitung nicht mehr installieren.
- `netlify/functions/attendance-time-edit.mts` — vorhandene Bearbeitung beibehalten, manuellen Create-Pfad ergänzen, Begründung für neue Oberfläche optional mit neutralem Audit-Fallback.
- `netlify/functions/unified-reports.mts` — `scope: 'actual' | 'planned'`, getrennte Zeilenmodelle, Summen, PDF/Excel-Titel und Dateinamen.
- `scripts/admin-time-editing-test.mjs` — auf neue React-native Bearbeitung umstellen oder durch die neuen Stundenzetteltests ersetzen.
- `package.json` — neue Regressionstests in `verify:unified` aufnehmen.

**Delete after replacement is verified**
- `frontend/src/admin-time-editing.js` — nicht mehr benötigte MutationObserver-/DOM-Nachrüstung.

---

### Task 1: Pure Stundenzettel-Datenmodelle und Regression

**Files:**
- Create: `frontend/src/timesheet-utils.js`
- Create: `scripts/timesheet-page-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildActualSessions(entries, employeeNames)`, `buildPlannedRows(entries, employeeNames)`, `sumMinutes(rows, field)`, `plannedNetMinutes(date, start, end, pauseMinutes)`.
- Consumes: Attendance-Events mit `userId`, `id`, `action`, `clientOccurredAt`, `eventDate`, `pauseMinutesAdjustment`; Schedule-Einträge mit `employeeUserId`, `employeeName`, `date`, `start`, `end`, `pauseMinutes`, `location`, `workArea`.

- [ ] **Step 1: Write the failing regression test**

```js
// scripts/timesheet-page-test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync('frontend/src/App.jsx', 'utf8')
const utils = fs.readFileSync('frontend/src/timesheet-utils.js', 'utf8')

assert.match(app, /label: 'Stundenzettel'/)
assert.doesNotMatch(app, /label: 'Korrekturen'/)
assert.doesNotMatch(app, /Korrektur beantragen/)
assert.match(app, /Arbeitsstunden – tatsächlich/)
assert.match(app, /Dienstplanstunden – geplant/)
assert.match(utils, /export function buildActualSessions/)
assert.match(utils, /export function buildPlannedRows/)
assert.match(utils, /24 \* 60/)
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node scripts/timesheet-page-test.mjs`

Expected: FAIL because `timesheet-utils.js` and the new Stundenzettel UI do not exist yet.

- [ ] **Step 3: Implement the pure helpers**

```js
export function plannedNetMinutes(date, start, end, pauseMinutes = 0) {
  const startAt = new Date(`${date}T${start}:00`)
  let endAt = new Date(`${date}T${end}:00`)
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000)
  const gross = Math.round((endAt - startAt) / 60000)
  return Math.max(0, gross - Math.max(0, Number(pauseMinutes) || 0))
}

export function buildActualSessions(entries, employeeNames = new Map()) {
  const byUser = new Map()
  for (const event of [...entries].sort((a, b) => String(a.clientOccurredAt).localeCompare(String(b.clientOccurredAt)))) {
    const userId = String(event.userId || '')
    if (!userId) continue
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId).push(event)
  }
  const sessions = []
  for (const [userId, events] of byUser) {
    let current = null
    for (const event of events) {
      if (event.action === 'clock-in') {
        if (current) sessions.push({ ...current, open: true, netMinutes: 0 })
        current = { userId, employeeName: event.employeeName || employeeNames.get(userId) || 'Mitarbeiter', date: event.eventDate, clockInEventId: event.id, clockOutEventId: null, clockInAt: event.clientOccurredAt, clockOutAt: null, breakMinutes: 0, breakStart: null, location: event.workSiteName || event.objectId || '–' }
      } else if (current && event.action === 'break-start') current.breakStart = event.clientOccurredAt
      else if (current && event.action === 'break-end' && current.breakStart) {
        current.breakMinutes += Math.max(0, Math.round((new Date(event.clientOccurredAt) - new Date(current.breakStart)) / 60000))
        current.breakStart = null
      } else if (current && event.action === 'clock-out') {
        current.clockOutEventId = event.id
        current.clockOutAt = event.clientOccurredAt
        if (event.pauseMinutesAdjustment !== null && event.pauseMinutesAdjustment !== undefined) current.breakMinutes = Math.max(0, Number(event.pauseMinutesAdjustment) || 0)
        const gross = Math.max(0, Math.round((new Date(current.clockOutAt) - new Date(current.clockInAt)) / 60000))
        current.netMinutes = Math.max(0, gross - current.breakMinutes)
        current.open = false
        sessions.push(current)
        current = null
      }
    }
    if (current) sessions.push({ ...current, open: true, netMinutes: 0 })
  }
  return sessions.sort((a, b) => `${a.date}-${a.employeeName}-${a.clockInAt}`.localeCompare(`${b.date}-${b.employeeName}-${b.clockInAt}`, 'de'))
}
```

`buildPlannedRows` maps each Schedule-Eintrag auf `{ userId, employeeName, date, start, end, pauseMinutes, netMinutes, location, workArea }` und berechnet `netMinutes` ausschließlich mit `plannedNetMinutes`; `sumMinutes(rows, field)` summiert numerisch nur den angegebenen Minutenwert.

- [ ] **Step 4: Add unit assertions for multi-user and overnight behavior**

```js
import { buildActualSessions, plannedNetMinutes } from '../frontend/src/timesheet-utils.js'

assert.equal(plannedNetMinutes('2026-08-08', '22:00', '06:00', 30), 450)
const sessions = buildActualSessions([
  { id: 'a1', userId: 'a', action: 'clock-in', clientOccurredAt: '2026-08-08T06:00:00Z', eventDate: '2026-08-08' },
  { id: 'b1', userId: 'b', action: 'clock-in', clientOccurredAt: '2026-08-08T07:00:00Z', eventDate: '2026-08-08' },
  { id: 'a2', userId: 'a', action: 'clock-out', clientOccurredAt: '2026-08-08T14:00:00Z', eventDate: '2026-08-08' },
  { id: 'b2', userId: 'b', action: 'clock-out', clientOccurredAt: '2026-08-08T17:00:00Z', eventDate: '2026-08-08' },
])
assert.equal(sessions.length, 2)
assert.deepEqual(new Set(sessions.map((row) => row.userId)), new Set(['a', 'b']))
```

- [ ] **Step 5: Run the helper assertions**

Run: `node scripts/timesheet-page-test.mjs`

Expected at this intermediate point: helper assertions PASS; UI label assertions still FAIL until Task 3.

- [ ] **Step 6: Commit the helper foundation**

```bash
git add frontend/src/timesheet-utils.js scripts/timesheet-page-test.mjs package.json
git commit -m "test: define Stundenzettel data model"
```

---

### Task 2: Sichere manuelle Stundenzettel-Einträge und direkte Bearbeitung

**Files:**
- Modify: `netlify/functions/attendance-time-edit.mts`
- Create: `scripts/timesheet-create-test.mjs`
- Modify: `scripts/admin-time-editing-test.mjs`

**Interfaces:**
- Existing edit request remains compatible: `{ clockInEventId, clockOutEventId, clockInAt, clockOutAt, pauseMinutes, reason? }`.
- New create request: `{ action: 'create-session', userId, clockInAt, clockOutAt, pauseMinutes, objectId?, scheduleId? }`.
- Response: `{ saved: true, created: true, clockInEventId, clockOutEventId }` for create; existing edit response stays unchanged.

- [ ] **Step 1: Write the failing source-contract test**

```js
// scripts/timesheet-create-test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('netlify/functions/attendance-time-edit.mts', 'utf8')
assert.match(source, /create-session/)
assert.match(source, /DIRECT_TIME_EDIT_ROLES/)
assert.match(source, /Manueller Stundenzettel-Eintrag/)
assert.match(source, /pg_advisory_xact_lock/)
assert.match(source, /attendance_audit_log/)
assert.match(source, /attendance_adjustments/)
assert.match(source, /überschneidet sich/i)
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/timesheet-create-test.mjs`

Expected: FAIL because `create-session` is not supported.

- [ ] **Step 3: Make the edit reason optional with an audit fallback**

```ts
const suppliedReason = String(body.reason || '').trim().slice(0, 1000)
const reason = suppliedReason || 'Manuelle Bearbeitung im Stundenzettel'
if (!clockInEventId) return json({ message: 'Arbeitsbeginn ist erforderlich.' }, 400)
```

Keep the current role check, future-time validation, overlap validation and immutable audit log. Existing callers that send a reason remain fully compatible.

- [ ] **Step 4: Add the create-session branch before existing edit resolution**

```ts
if (body.action === 'create-session') {
  const userId = String(body.userId || '').trim()
  const newStart = parseRequiredDate(body.clockInAt, 'Arbeitsbeginn')
  const newEnd = parseRequiredDate(body.clockOutAt, 'Arbeitsende')
  const pauseMinutes = parsePause(body.pauseMinutes)
  if (!userId) return json({ message: 'Mitarbeiter ist erforderlich.' }, 400)
  if (newEnd <= newStart) return json({ message: 'Das Arbeitsende darf nicht vor dem Arbeitsbeginn liegen.' }, 400)
  const grossMinutes = Math.round((newEnd.getTime() - newStart.getTime()) / 60000)
  if (pauseMinutes > grossMinutes) return json({ message: 'Die Pause darf nicht länger als die Arbeitszeit sein.' }, 400)
  return createManualSession(sql, current, { userId, newStart, newEnd, pauseMinutes, objectId: String(body.objectId || '') || null, scheduleId: String(body.scheduleId || '') || null })
}
```

`createManualSession` acquires `pg_advisory_xact_lock(hashtext(userId))`, rejects any existing attendance session intersecting `[newStart,newEnd]`, inserts a synthetic `clock-in` and `clock-out`, inserts the pause into `attendance_adjustments`, and appends an `attendance_audit_log` row with action `admin-time-create` and reason `Manueller Stundenzettel-Eintrag`. It must not manufacture break-start/break-end events because the pause adjustment is the authoritative manual pause value.

- [ ] **Step 5: Add explicit manager/admin/owner and employee-denial assertions to the existing regression test**

```js
assert.match(source, /new Set\(\['owner', 'admin', 'manager'\]\)/)
assert.match(source, /if \(!DIRECT_TIME_EDIT_ROLES\.has\(current\.role\)\).*403/s)
```

- [ ] **Step 6: Run the focused tests**

Run: `node scripts/timesheet-create-test.mjs && node scripts/admin-time-editing-test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit backend time editing/create support**

```bash
git add netlify/functions/attendance-time-edit.mts scripts/timesheet-create-test.mjs scripts/admin-time-editing-test.mjs
git commit -m "feat: support direct Stundenzettel entries"
```

---

### Task 3: React-Stundenzettel statt Korrekturen

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/main.jsx`
- Delete: `frontend/src/admin-time-editing.js`
- Modify: `scripts/timesheet-page-test.mjs`

**Interfaces:**
- Consumes `buildActualSessions`, `buildPlannedRows`, `sumMinutes` from `timesheet-utils.js`.
- Actual data: `GET /api/attendance?resource=history&from=YYYY-MM-DD&to=YYYY-MM-DD[&userId=...]`.
- Planned data: `GET /api/schedule-v2?resource=entries&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Employee directory: `GET /api/registrations` for management.
- Save edit/create: `POST /api/attendance-time-edit`.

- [ ] **Step 1: Change navigation and routing**

```jsx
const NAVIGATION = [
  { key: 'overview', label: 'Übersicht', roles: ['owner', 'admin', 'manager'] },
  { key: 'attendance', label: 'Zeiterfassung', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'employees', label: 'Mitarbeiter', roles: ['owner', 'admin', 'manager'] },
  { key: 'schedule', label: 'Dienstplan', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'timesheet', label: 'Stundenzettel', roles: ['owner', 'admin', 'manager', 'employee'] },
  { key: 'worksites', label: 'Einsatzorte', roles: ['owner', 'admin'] },
  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },
  { key: 'settings', label: 'Einstellungen', roles: ['owner', 'admin'] },
]
```

Remove `CorrectionsPage`, remove the `corrections` route, and replace the old management-only `times` route with `timesheet`. For employee kiosk navigation add a third button `Stundenzettel` and set `aria-label` appropriately.

- [ ] **Step 2: Implement independent loading for actual and planned sections**

```jsx
const [actual, setActual] = useState({ rows: [], error: '' })
const [planned, setPlanned] = useState({ rows: [], error: '' })

async function loadActual() {
  try {
    const params = new URLSearchParams({ resource: 'history', from, to })
    if (management && userId) params.set('userId', userId)
    const data = await apiJson(`/api/attendance?${params}`)
    setActual({ rows: buildActualSessions(data.entries || [], employeeNames), error: '' })
  } catch (error) {
    setActual((current) => ({ ...current, error: error.message }))
  }
}

async function loadPlanned() {
  try {
    const data = await apiJson(`/api/schedule-v2?resource=entries&from=${from}&to=${to}`)
    const visible = management && userId ? (data.entries || []).filter((row) => String(row.employeeUserId || '') === userId) : (data.entries || [])
    setPlanned({ rows: buildPlannedRows(visible, employeeNames), error: '' })
  } catch (error) {
    setPlanned((current) => ({ ...current, error: error.message }))
  }
}
```

For employees, never send or expose another employee ID; rely on the server’s existing employee filtering and render only returned own rows.

- [ ] **Step 3: Render “Arbeitsstunden – tatsächlich” as editable day cards**

Each card shows date, employee (management view), Beginn, Ende, Pause, Netto and Einsatzort. Open sessions display `Offen` and `Netto –`. Management receives a `Bearbeiten` button; employee receives no edit action.

```jsx
<PageHeader title="Arbeitsstunden – tatsächlich" subtitle="Gestempelte und manuell ergänzte Arbeitszeiten." />
{management && <button className="primary-button compact" onClick={() => openNewActual()}>Arbeitszeit eintragen</button>}
```

The editor contains only Mitarbeiter (new entries), Datum/Beginn, Ende and Pause plus optional Einsatzort. It contains no Korrektur-, Antrag- or Begründungsfeld. On existing entries it posts event IDs; on new entries it posts `action: 'create-session'`.

- [ ] **Step 4: Render “Dienstplanstunden – geplant” separately**

```jsx
<PageHeader title="Dienstplanstunden – geplant" subtitle="Nur geplante Soll-Stunden aus dem Dienstplan." />
```

Each row shows Datum, Mitarbeiter (management), `start–end`, Pause, geplante Netto-Stunden, Einsatzort/Arbeitsbereich. Under the list render employee totals and a grand total calculated only from `planned.rows`.

- [ ] **Step 5: Add separate export actions to both sections**

```jsx
<button onClick={() => exportTimesheet('actual', 'pdf')}>Ist-Stunden PDF</button>
<button onClick={() => exportTimesheet('actual', 'xlsx')}>Ist-Stunden Excel</button>
<button onClick={() => exportTimesheet('planned', 'pdf')}>Dienstplanstunden PDF</button>
<button onClick={() => exportTimesheet('planned', 'xlsx')}>Dienstplanstunden Excel</button>
```

Only management sees download actions. Payload: `{ from, to, userIds: userId ? [userId] : [], scope, format }`.

- [ ] **Step 6: Remove the DOM patch installer**

`frontend/src/main.jsx` must no longer import or call `installAdminTimeEditing`; delete `frontend/src/admin-time-editing.js` only after the React editor is working.

- [ ] **Step 7: Add mobile styles without changing the brand palette**

```css
.timesheet-sections { display: grid; gap: 18px; }
.timesheet-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.timesheet-card-grid { display: grid; gap: 12px; }
.timesheet-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
@media (max-width: 720px) {
  .timesheet-actions > button { width: 100%; }
  .timesheet-editor .form-grid.three { grid-template-columns: 1fr; }
}
```

Reuse existing variables/classes for colors, borders, button styles and typography; do not introduce a new color system.

- [ ] **Step 8: Run the page regression**

Run: `node scripts/timesheet-page-test.mjs`

Expected: PASS and no occurrence of `Korrektur beantragen` or navigation label `Korrekturen` in `App.jsx`.

- [ ] **Step 9: Commit the UI replacement**

```bash
git add frontend/src/App.jsx frontend/src/styles.css frontend/src/main.jsx frontend/src/timesheet-utils.js scripts/timesheet-page-test.mjs
git rm frontend/src/admin-time-editing.js
git commit -m "feat: replace corrections with Stundenzettel"
```

---

### Task 4: Getrennte PDF-/Excel-Exporte für Ist und Plan

**Files:**
- Modify: `netlify/functions/unified-reports.mts`
- Create: `scripts/timesheet-report-scope-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Request adds `scope: 'actual' | 'planned'`.
- `actual` uses attendance events only for rows/totals; schedule may only contribute display metadata such as a location/name fallback and must never create an attendance row.
- `planned` uses schedule rows only; no attendance event may change planned totals.

- [ ] **Step 1: Write the failing scope regression**

```js
// scripts/timesheet-report-scope-test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('netlify/functions/unified-reports.mts', 'utf8')
assert.match(source, /scope/)
assert.match(source, /actual/)
assert.match(source, /planned/)
assert.match(source, /Stundenzettel/)
assert.match(source, /Dienstplanstunden/)
assert.match(source, /Habun-Stundenzettel-/)
assert.match(source, /Habun-Dienstplanstunden-/)
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/timesheet-report-scope-test.mjs`

Expected: FAIL because the endpoint currently creates one combined Plan/Ist report.

- [ ] **Step 3: Split row construction**

```ts
type ActualRow = { employeeName: string; date: string; actualStart: string; actualEnd: string; pauseMinutes: number; netMinutes: number; location: string; warning: boolean }
type PlannedRow = { employeeName: string; date: string; plannedStart: string; plannedEnd: string; pauseMinutes: number; netMinutes: number; location: string; workArea: string }

const scope = body.scope === 'planned' ? 'planned' : 'actual'
```

`buildActualRows` must not append missing Schedule rows. `buildPlannedRows` iterates Schedule rows directly and calculates net minutes with overnight support: when `end <= start`, treat end as next day before subtracting pause.

- [ ] **Step 4: Scope database and schedule work correctly**

For `scope === 'actual'`, query attendance and load names; schedule loading is optional metadata only. For `scope === 'planned'`, load schedule entries and names, skip the attendance SQL query entirely, filter schedule entries by `userIds`, and reject empty results with `NO_DATA`.

- [ ] **Step 5: Render scope-specific PDF and Excel documents**

Actual PDF/Excel columns: `Name, Datum, Beginn, Ende, Pause, Netto, Einsatzort, Hinweis`.

Planned PDF/Excel columns: `Name, Datum, Plan Beginn, Plan Ende, Pause, Geplant Netto, Einsatzort, Arbeitsbereich`.

Document titles and filenames:

```ts
const title = scope === 'planned' ? 'Dienstplanstunden – geplant' : 'Stundenzettel – tatsächliche Arbeitszeiten'
const basename = scope === 'planned' ? `Habun-Dienstplanstunden-${from}-bis-${to}` : `Habun-Stundenzettel-${from}-bis-${to}`
```

Both documents contain per-employee totals and grand total from their own row set only.

- [ ] **Step 6: Run the report regression and existing branding/download tests**

Run: `node scripts/timesheet-report-scope-test.mjs && node scripts/report-download-contract-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/final-export-logo-test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit report separation**

```bash
git add netlify/functions/unified-reports.mts scripts/timesheet-report-scope-test.mjs package.json
git commit -m "feat: separate actual and planned hour exports"
```

---

### Task 5: Rollen, Regressionen und mobile E2E-Abnahme

**Files:**
- Create: `tests/e2e/timesheet-page.spec.mjs`
- Modify: `scripts/employee-access-policy-test.mjs`
- Modify: `scripts/unified-portal-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Management roles: owner/admin/manager.
- Employee navigation: attendance, schedule, timesheet only.
- Export buttons: management only.
- Edit/create buttons: management only.

- [ ] **Step 1: Add employee-access source assertions**

```js
assert.match(app, /key: 'timesheet'.*roles: \['owner', 'admin', 'manager', 'employee'\]/s)
assert.doesNotMatch(app, /key: 'corrections'/)
assert.match(app, /management && .*Arbeitszeit eintragen/s)
```

- [ ] **Step 2: Add Playwright coverage for the management mobile page**

```js
test('Stundenzettel trennt Ist und Plan auf Mobilbreite', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsManagement(page)
  await page.getByRole('button', { name: 'Stundenzettel' }).click()
  await expect(page.getByRole('heading', { name: 'Arbeitsstunden – tatsächlich' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dienstplanstunden – geplant' })).toBeVisible()
  await expect(page.getByText('Korrektur beantragen')).toHaveCount(0)
})
```

Use the same authentication/bootstrap helper pattern already used by the repository’s existing E2E specs; do not create a second auth mechanism.

- [ ] **Step 3: Add edit/create interaction E2E**

Mock or seed one completed attendance session and one employee. Open `Bearbeiten`, change pause, save, reload and assert the recalculated net value. Then open `Arbeitszeit eintragen`, create a missing day and assert it appears in the Ist section without appearing in the Plan section.

- [ ] **Step 4: Add scope-export E2E**

Click `Ist-Stunden PDF` and assert the response `content-type` is PDF and filename contains `Habun-Stundenzettel-`; click `Dienstplanstunden Excel` and assert XLSX content type and filename contains `Habun-Dienstplanstunden-`.

- [ ] **Step 5: Run focused portal regressions**

Run: `node scripts/timesheet-page-test.mjs && node scripts/timesheet-create-test.mjs && node scripts/timesheet-report-scope-test.mjs && node scripts/employee-access-policy-test.mjs && node scripts/unified-portal-test.mjs`

Expected: PASS.

- [ ] **Step 6: Run complete repository verification**

Run: `npm run verify:all`

Expected: PASS with no regressions in Zeiterfassung, Dienstplan, Standort, PDF/Excel or Rollenlogik.

- [ ] **Step 7: Run the Stundenzettel E2E**

Run: `npx playwright test tests/e2e/timesheet-page.spec.mjs`

Expected: PASS on the configured test target.

- [ ] **Step 8: Commit tests and final wiring**

```bash
git add tests/e2e/timesheet-page.spec.mjs scripts/employee-access-policy-test.mjs scripts/unified-portal-test.mjs package.json
git commit -m "test: verify Stundenzettel workflow"
```

---

### Task 6: Production-sichere Veröffentlichung und Nachprüfung

**Files:**
- No feature files unless verification exposes a defect.

**Interfaces:**
- Production site: existing Netlify project `habun-mitarbeiterportal`.
- Source branch: `main`.

- [ ] **Step 1: Verify the exact commit before deployment**

Run: `git status --short && git log -1 --oneline && npm run verify:all`

Expected: clean working tree and all checks PASS.

- [ ] **Step 2: Deploy only after verification**

Use the existing Netlify-linked production project; do not create or rename a second production project.

- [ ] **Step 3: Check production navigation and both sections**

Verify on the live URL that `Korrekturen` is absent, `Stundenzettel` is present, and both `Arbeitsstunden – tatsächlich` and `Dienstplanstunden – geplant` load independently.

- [ ] **Step 4: Verify one safe management edit and one export**

Use a non-destructive/known test entry where available. Confirm the edit is reflected after reload and that actual PDF and planned Excel return valid files. Do not modify an unrelated employee’s production record only for testing.

- [ ] **Step 5: Verify employee isolation**

Confirm an employee account cannot see employee selectors, other employees’ data, edit/create buttons, or management exports.

- [ ] **Step 6: Record completion only after production checks pass**

If any production check fails, fix it on source, rerun the focused tests plus `npm run verify:all`, then redeploy. Do not declare the feature complete while production and source differ.
