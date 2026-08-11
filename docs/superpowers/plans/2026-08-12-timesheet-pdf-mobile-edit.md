# Stundenzettel PDF and Mobile Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the earlier Habun Stundenzettel PDF appearance while keeping the new schedule-only timesheet data model, and make timesheet edit/save/delete easy and safe on mobile.

**Architecture:** Keep `timesheet_entries` as the only Stundenzettel source. Add a soft-suppression state for schedule-linked entries so deleting a Stundenzettel never deletes or mutates the Dienstplan and never gets silently recreated by open-month synchronization. Rebuild the monthly PDF renderer around the former portrait/gold Habun layout and render the same timesheet rows as responsive mobile cards with visible edit actions.

**Tech Stack:** React 19, Netlify Functions, `@netlify/database`, PostgreSQL migrations, `pdf-lib`, ExcelJS, Playwright, Node source-contract tests.

## Global Constraints

- Stundenzettel uses only the independent `timesheet_entries` data; Attendance/Stempel data must never write into or replace it.
- Existing current-month / correction-window rule remains unchanged: schedule sync is allowed through the 10th day of the following month; from the 11th at 00:00 Europe/Berlin it is closed.
- Manual updates and deletions affect only the Stundenzettel, never the underlying Dienstplan or Stempelprotokoll.
- A deliberate manual correction or deletion must not be silently overwritten by later schedule synchronization.
- PDF title is exactly **Stundenzettel**.
- PDF uses the earlier Habun visual structure: employee page, gold header row, total box, Anmerkungen box, central translucent Habun watermark, central company settings for logo/company details.
- PDF columns are exactly: Datum, Startzeit, Endzeit, Pause, Dauer, Status, Tätigkeit / Einsatzort.
- Status is `Dienstplan` for untouched schedule rows and `Manuell` for manually created/overridden rows; Attendance status such as `Erfasst` is not used.
- Mobile editing must expose **Bearbeiten**, **Speichern**, **Löschen**, and **Schließen/Abbrechen** without horizontal scrolling.
- Management roles remain `owner`, `admin`, `manager`; employee permissions are not broadened.
- Do not create a new general “Berichte” navigation item.
- Before modifying any `netlify/functions/**` or `netlify/database/**` file, retrieve current Netlify coding context for Functions and Database and follow it.
- Use TDD: establish RED before each production change, then GREEN, then refactor only if required.
- Do not trigger production deploys during intermediate steps. Use repository tests/local or GitHub CI; production deployment happens only after final approval/merge.

---

### Task 1: Add safe suppression state for deleted schedule-linked Stundenzettel rows

**Files:**
- Create: `netlify/database/migrations/20260812020000_add-timesheet-entry-suppression/migration.sql`
- Modify: `netlify/functions/_shared/timesheet-repository.mts`
- Modify: `netlify/functions/_shared/timesheet-manual-repository.mts`
- Create: `scripts/timesheet-suppression-schema-test.mjs`
- Create: `scripts/timesheet-suppression-repository-source-test.mjs`
- Modify: `scripts/verify-timesheet-monthly-freeze.mjs`

**Interfaces:**
- Produces `TimesheetEntry.suppressed: boolean`, `suppressedAt: string`, `suppressedBy: string`.
- Produces `suppressTimesheetEntry(id: string, actorId: string)`.
- Produces `restoreScheduleTimesheetEntry(id: string, actorId: string)`.
- `listTimesheetEntries(...)` returns only non-suppressed rows.
- `findTimesheetEntry(...)` can still return suppressed rows so management can audit/restore them by id.
- `upsertScheduleTimesheetEntry(...)` must not overwrite or unsuppress a suppressed row.

- [ ] **Step 1: Write the failing schema contract test**

Create `scripts/timesheet-suppression-schema-test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const path = 'netlify/database/migrations/20260812020000_add-timesheet-entry-suppression/migration.sql'
assert.equal(fs.existsSync(path), true, 'timesheet suppression migration missing')
const sql = fs.readFileSync(path, 'utf8')
assert.match(sql, /ADD COLUMN suppressed boolean NOT NULL DEFAULT false/i)
assert.match(sql, /ADD COLUMN suppressed_at timestamp with time zone/i)
assert.match(sql, /ADD COLUMN suppressed_by text/i)
console.log('timesheet suppression schema contract passed')
```

- [ ] **Step 2: Run the new schema test and confirm RED**

Run:

```bash
node scripts/timesheet-suppression-schema-test.mjs
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the migration**

Create `netlify/database/migrations/20260812020000_add-timesheet-entry-suppression/migration.sql`:

```sql
ALTER TABLE timesheet_entries
  ADD COLUMN suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN suppressed_at timestamp with time zone,
  ADD COLUMN suppressed_by text;

CREATE INDEX timesheet_entries_visible_range_idx
  ON timesheet_entries(work_date, employee_user_id, start_time)
  WHERE suppressed = false;
```

- [ ] **Step 4: Run the schema test and confirm GREEN**

Run:

```bash
node scripts/timesheet-suppression-schema-test.mjs
```

Expected: `timesheet suppression schema contract passed`.

- [ ] **Step 5: Write the failing repository source contract**

Create `scripts/timesheet-suppression-repository-source-test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const repository = fs.readFileSync('netlify/functions/_shared/timesheet-repository.mts', 'utf8')
const manual = fs.readFileSync('netlify/functions/_shared/timesheet-manual-repository.mts', 'utf8')

assert.match(repository, /suppressed:\s*Boolean\(row\.suppressed\)/)
assert.match(repository, /WHERE work_date BETWEEN[\s\S]*suppressed = false/)
assert.match(repository, /WHERE timesheet_entries\.manual_override = false[\s\S]*timesheet_entries\.suppressed = false/)
assert.match(manual, /export async function suppressTimesheetEntry/)
assert.match(manual, /suppressed = true/)
assert.match(manual, /manual_override = true/)
assert.match(manual, /export async function restoreScheduleTimesheetEntry/)
assert.match(manual, /suppressed = false/)
assert.match(manual, /manual_override = false/)
assert.match(manual, /source = 'schedule'/)
console.log('timesheet suppression repository source contract passed')
```

- [ ] **Step 6: Run the repository source contract and confirm RED**

Run:

```bash
node scripts/timesheet-suppression-repository-source-test.mjs
```

Expected: FAIL because suppression fields/functions are absent.

- [ ] **Step 7: Extend the mapped timesheet type and visible queries**

In `netlify/functions/_shared/timesheet-repository.mts`, extend `TimesheetEntry` with:

```ts
suppressed: boolean
suppressedAt: string
suppressedBy: string
```

Extend `mapTimesheetEntryRow` with:

```ts
suppressed: Boolean(row.suppressed),
suppressedAt: iso(row.suppressed_at),
suppressedBy: String(row.suppressed_by || ''),
```

Change `listTimesheetEntries` SQL to include:

```sql
AND suppressed = false
```

Change the `ON CONFLICT ... DO UPDATE` guard in `upsertScheduleTimesheetEntry` to:

```sql
WHERE timesheet_entries.manual_override = false
  AND timesheet_entries.suppressed = false
```

Do not remove the row or null its `schedule_shift_id` when it is suppressed.

- [ ] **Step 8: Add suppression and restoration repository functions**

In `netlify/functions/_shared/timesheet-manual-repository.mts`, add:

```ts
export async function suppressTimesheetEntry(id: string, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE timesheet_entries SET
       suppressed = true,
       suppressed_at = now(),
       suppressed_by = $2,
       manual_override = true,
       updated_at = now(),
       updated_by = $2
     WHERE id = $1
     RETURNING *`,
    [id, actorId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}

export async function restoreScheduleTimesheetEntry(id: string, actorId: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `UPDATE timesheet_entries SET
       suppressed = false,
       suppressed_at = NULL,
       suppressed_by = NULL,
       source = 'schedule',
       manual_override = false,
       updated_at = now(),
       updated_by = $2
     WHERE id = $1
       AND schedule_shift_id IS NOT NULL
     RETURNING *`,
    [id, actorId],
  )
  return result.rows[0] ? mapTimesheetEntryRow(result.rows[0]) : null
}
```

Keep `deleteManualTimesheetEntry` for manual-only rows with `schedule_shift_id IS NULL`.

- [ ] **Step 9: Run repository contracts and existing month tests**

Run:

```bash
node scripts/timesheet-suppression-repository-source-test.mjs
node scripts/verify-timesheet-monthly-freeze.mjs
```

Expected: new suppression contract PASS; existing monthly tests remain PASS.

- [ ] **Step 10: Wire both new tests into the monthly verifier**

Append before the final log in `scripts/verify-timesheet-monthly-freeze.mjs`:

```js
await import('./timesheet-suppression-schema-test.mjs')
await import('./timesheet-suppression-repository-source-test.mjs')
```

- [ ] **Step 11: Commit Task 1**

```bash
git add netlify/database/migrations/20260812020000_add-timesheet-entry-suppression/migration.sql \
  netlify/functions/_shared/timesheet-repository.mts \
  netlify/functions/_shared/timesheet-manual-repository.mts \
  scripts/timesheet-suppression-schema-test.mjs \
  scripts/timesheet-suppression-repository-source-test.mjs \
  scripts/verify-timesheet-monthly-freeze.mjs
git commit -m "feat: protect deleted timesheet entries from schedule sync"
```

---

### Task 2: Add Stundenzettel delete and restore API behavior with audit protection

**Files:**
- Modify: `netlify/functions/timesheets.mts`
- Create: `scripts/timesheet-delete-restore-api-source-test.mjs`
- Modify: `scripts/verify-timesheet-monthly-freeze.mjs`

**Interfaces:**
- Existing `DELETE /api/timesheets` with `{ action: 'manual-delete', id, reason }` becomes valid for both manual-only and schedule-linked timesheet rows.
- Manual-only rows are physically deleted.
- Schedule-linked rows are soft-suppressed through `suppressTimesheetEntry`.
- New `POST /api/timesheets` action `{ action: 'restore-schedule', id, reason }` is allowed only while the row’s month is still schedule-sync-open.
- Restore never reads Attendance data and never changes the Dienstplan.

- [ ] **Step 1: Write the failing API source contract**

Create `scripts/timesheet-delete-restore-api-source-test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheets.mts', 'utf8')
assert.match(source, /suppressTimesheetEntry/)
assert.match(source, /restoreScheduleTimesheetEntry/)
assert.match(source, /action === 'manual-delete'/)
assert.match(source, /existing\.scheduleShiftId[\s\S]*suppressTimesheetEntry/)
assert.match(source, /action === 'restore-schedule'/)
assert.match(source, /isTimesheetScheduleSyncOpen\(monthKeyForDate\(existing\.workDate\), now\)/)
assert.match(source, /action: 'manual-delete'/)
assert.match(source, /action: 'schedule-restore'/)
console.log('timesheet delete/restore api source contract passed')
```

- [ ] **Step 2: Run the API source contract and confirm RED**

Run:

```bash
node scripts/timesheet-delete-restore-api-source-test.mjs
```

Expected: FAIL because schedule-linked deletion is currently rejected and restore does not exist.

- [ ] **Step 3: Import the new repository functions**

Change the import from `timesheet-manual-repository.mts` to include:

```ts
restoreScheduleTimesheetEntry,
suppressTimesheetEntry,
```

- [ ] **Step 4: Replace the schedule-linked delete rejection with safe suppression**

Replace the current DELETE branch body after `existing` is loaded with this logic:

```ts
const removed = existing.scheduleShiftId
  ? await suppressTimesheetEntry(id, current.userId)
  : await deleteManualTimesheetEntry(id)
if (!removed) return json({ message: 'Stundenzettel-Eintrag konnte nicht gelöscht werden.' }, 409)
await writeTimesheetAudit({
  actorId: current.userId,
  actorRole: current.role,
  action: 'manual-delete',
  entryId: removed.id,
  monthKey: monthKeyForDate(removed.workDate),
  reason,
  beforeData: existing,
  afterData: existing.scheduleShiftId ? removed : null,
})
return json({ deleted: true, id, suppressed: Boolean(existing.scheduleShiftId) })
```

Do not call any schedule delete/update function here.

- [ ] **Step 5: Add `restore-schedule` action guarded by the Berlin cutoff policy**

Add a POST branch after `manual-create`:

```ts
if (request.method === 'POST' && action === 'restore-schedule') {
  const id = text(body.id, 120)
  const reason = requireReason(body.reason)
  const existing = id ? await findTimesheetEntry(id) : null
  if (!existing || !existing.scheduleShiftId) {
    return json({ message: 'Dienstplan-Stundenzettel wurde nicht gefunden.' }, 404)
  }
  const now = new Date()
  if (!isTimesheetScheduleSyncOpen(monthKeyForDate(existing.workDate), now)) {
    return json({ message: 'Der abgeschlossene Monat kann nicht mehr automatisch aus dem Dienstplan übernommen werden.' }, 409)
  }
  const restored = await restoreScheduleTimesheetEntry(id, current.userId)
  if (!restored) return json({ message: 'Dienstplan-Stundenzettel konnte nicht wiederhergestellt werden.' }, 409)
  await syncPublishedScheduleRange(existing.workDate, existing.workDate, current.userId, now)
  const refreshed = await findTimesheetEntry(id)
  await writeTimesheetAudit({
    actorId: current.userId,
    actorRole: current.role,
    action: 'schedule-restore',
    entryId: id,
    monthKey: monthKeyForDate(existing.workDate),
    reason,
    beforeData: existing,
    afterData: refreshed || restored,
  })
  return json({ entry: refreshed || restored })
}
```

This restores the Stundenzettel from the existing Dienstplan source only while the monthly sync window is open.

- [ ] **Step 6: Run the API contract and monthly verifier**

Run:

```bash
node scripts/timesheet-delete-restore-api-source-test.mjs
node scripts/verify-timesheet-monthly-freeze.mjs
```

Expected: PASS.

- [ ] **Step 7: Add the API test to the monthly verifier**

Append:

```js
await import('./timesheet-delete-restore-api-source-test.mjs')
```

before the final log.

- [ ] **Step 8: Commit Task 2**

```bash
git add netlify/functions/timesheets.mts scripts/timesheet-delete-restore-api-source-test.mjs scripts/verify-timesheet-monthly-freeze.mjs
git commit -m "feat: add safe timesheet delete and schedule restore"
```

---

### Task 3: Restore the former Habun portrait/gold Stundenzettel PDF design

**Files:**
- Modify: `netlify/functions/timesheet-monthly-reports.mts`
- Create: `scripts/timesheet-monthly-pdf-layout-source-test.mjs`
- Modify: `scripts/verify-timesheet-monthly-freeze.mjs`

**Interfaces:**
- `POST /api/timesheet-reports` keeps the existing request contract `{ from, to, userIds, format }`.
- PDF rows continue to come from `listTimesheetEntries` after `syncPublishedScheduleRange`; no Attendance query is introduced.
- PDF is A4 portrait, one employee starts per page, with blank calendar-day rows, gold table header, total box, Anmerkungen area and center watermark.

- [ ] **Step 1: Write the failing PDF layout source contract**

Create `scripts/timesheet-monthly-pdf-layout-source-test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('netlify/functions/timesheet-monthly-reports.mts', 'utf8')
assert.match(source, /page\.drawText\('Stundenzettel'/)
assert.doesNotMatch(source, /Arbeitszeitenbericht/)
assert.match(source, /Arbeitnehmer:/)
assert.match(source, /Datum.*Startzeit.*Endzeit.*Pause.*Dauer.*Status.*Tätigkeit \/ Einsatzort/s)
assert.match(source, /Dienstplan/)
assert.match(source, /Manuell/)
assert.match(source, /Anmerkungen/)
assert.match(source, /opacity:\s*0\.0[4-9]/)
assert.match(source, /gold/i)
assert.doesNotMatch(source, /attendance_events|\/api\/attendance|Erfasst/)
console.log('timesheet monthly PDF layout source contract passed')
```

- [ ] **Step 2: Run the PDF contract and confirm RED**

Run:

```bash
node scripts/timesheet-monthly-pdf-layout-source-test.mjs
```

Expected: FAIL because the current PDF uses the newer plain layout and lacks the former Habun structure.

- [ ] **Step 3: Add helpers for full-date rows and display status**

In `timesheet-monthly-reports.mts`, add:

```ts
function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function datesInRange(from: string, to: string) {
  const dates: string[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor)
  return dates
}

function shortGermanDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date)
}

function statusText(row: TimesheetEntry) {
  return row.source === 'manual' || row.manualOverride ? 'Manuell' : 'Dienstplan'
}
```

For each employee group, create a `Map<string, TimesheetEntry[]>` by `workDate` and emit at least one table row for every `datesInRange(from, to)` date; if a date has multiple shifts, emit the first with the date label and subsequent shifts with a blank date cell.

- [ ] **Step 4: Replace the PDF geometry with portrait A4 and Habun gold styling**

Use:

```ts
const width = 595
const height = 842
const margin = 34
const gold = rgb(0.86, 0.66, 0.18)
const pale = rgb(0.965, 0.965, 0.965)
const dark = rgb(0.08, 0.08, 0.08)
const line = rgb(0.28, 0.28, 0.28)
```

The page header must draw:

```ts
page.drawText('Stundenzettel', { x: 225, y: height - 48, size: 16, font: bold, color: dark })
page.drawText(monthOrRangeLabel(from, to), { x: 225, y: height - 68, size: 11, font: bold, color: dark })
page.drawText(`Arbeitnehmer: ${safePdfText(employeeName, 60)}`, { x: margin, y: height - 96, size: 10, font: bold, color: dark })
```

Use the central company settings logo loaded by the existing `embedLogo()` helper. Do not add a black background rectangle behind the logo.

- [ ] **Step 5: Add centered translucent watermark**

On every employee page, after embedding the logo and before table rows, draw:

```ts
if (logo) {
  const scale = Math.min(210 / logo.width, 155 / logo.height)
  const logoWidth = logo.width * scale
  const logoHeight = logo.height * scale
  page.drawImage(logo, {
    x: (width - logoWidth) / 2,
    y: (height - logoHeight) / 2 - 55,
    width: logoWidth,
    height: logoHeight,
    opacity: 0.06,
  })
}
```

- [ ] **Step 6: Draw the former-style gold table**

Use headers exactly:

```ts
const headers = ['Datum', 'Startzeit', 'Endzeit', 'Pause', 'Dauer', 'Status', 'Tätigkeit / Einsatzort']
```

Draw the table header rectangle with `gold`, black/dark text and visible borders. For each timesheet row draw:

```ts
[
  dateLabel,
  row?.start || '',
  row?.end || '',
  row ? `${row.pauseMinutes} Min.` : '',
  row ? durationText(row.netMinutes) : '',
  row ? statusText(row) : '',
  row ? safePdfText([row.workArea, row.location].filter(Boolean).join(' / '), 55) : '',
]
```

Blank dates must still render a bordered empty row.

- [ ] **Step 7: Draw the gold total and Anmerkungen box**

After the table, calculate the employee total from real entries only and draw:

```ts
page.drawRectangle({ x: margin, y: y - 28, width: 355, height: 24, color: gold, borderColor: line, borderWidth: 0.7 })
page.drawRectangle({ x: margin + 355, y: y - 28, width: 120, height: 24, color: gold, borderColor: line, borderWidth: 0.7 })
page.drawText('Gesamtdauer', { x: margin + 6, y: y - 20, size: 10, font: bold, color: dark })
page.drawText(`${durationText(total)} Std.`, { x: margin + 365, y: y - 20, size: 10, font: bold, color: dark })
```

Then draw an empty bordered `Anmerkungen` box approximately 62–72 pt high with `Anmerkungen` at the top-left.

At the bottom of every page, draw the current company settings summary from `settings.address`, `settings.phone`, `settings.email` in small text.

- [ ] **Step 8: Preserve multipage behavior correctly**

When the remaining `y` cannot fit the next row plus total/notes region, create a continuation page for the same employee, redraw watermark/header/table header, and continue rows. Start the next employee on a fresh page regardless of remaining space.

- [ ] **Step 9: Run PDF source contract and existing independent-report tests**

Run:

```bash
node scripts/timesheet-monthly-pdf-layout-source-test.mjs
node scripts/timesheet-report-independent-source-test.mjs
node scripts/verify-timesheet-monthly-freeze.mjs
```

Expected: PASS; no Attendance reference is introduced.

- [ ] **Step 10: Wire the PDF test into the monthly verifier**

Append:

```js
await import('./timesheet-monthly-pdf-layout-source-test.mjs')
```

before the final log.

- [ ] **Step 11: Commit Task 3**

```bash
git add netlify/functions/timesheet-monthly-reports.mts scripts/timesheet-monthly-pdf-layout-source-test.mjs scripts/verify-timesheet-monthly-freeze.mjs
git commit -m "feat: restore Habun timesheet PDF layout"
```

---

### Task 4: Make mobile Stundenzettel cards editable with visible Save/Delete controls

**Files:**
- Modify: `frontend/src/TimesheetMonthlyPage.jsx`
- Modify: `frontend/src/timesheet.css`
- Create: `scripts/timesheet-mobile-edit-source-test.mjs`
- Modify: `tests/e2e/timesheet-monthly.spec.mjs`
- Modify: `scripts/verify-timesheet-monthly-freeze.mjs`

**Interfaces:**
- Desktop keeps a table.
- Mobile renders `.timesheet-mobile-list` / `.timesheet-mobile-card` and hides the desktop table at widths `<= 720px`.
- Every mobile card has a visible `Bearbeiten` button.
- Editor has `Speichern`, `Löschen`, `Schließen`.
- Delete calls `DELETE /api/timesheets` with `{ action: 'manual-delete', id, reason }`.
- No Attendance endpoint is read by the Stundenzettel page.

- [ ] **Step 1: Write the failing mobile UI source contract**

Create `scripts/timesheet-mobile-edit-source-test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const page = fs.readFileSync('frontend/src/TimesheetMonthlyPage.jsx', 'utf8')
const css = fs.readFileSync('frontend/src/timesheet.css', 'utf8')
assert.match(page, /timesheet-mobile-list/)
assert.match(page, /timesheet-mobile-card/)
assert.match(page, />Bearbeiten<\/button>/)
assert.match(page, />Löschen<\/button>/)
assert.match(page, /action:\s*'manual-delete'/)
assert.match(page, /method:\s*'DELETE'/)
assert.doesNotMatch(page, /\/api\/attendance/)
assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.timesheet-desktop-table[\s\S]*display:\s*none/)
assert.match(css, /@media \(min-width: 721px\)[\s\S]*\.timesheet-mobile-list[\s\S]*display:\s*none/)
console.log('timesheet mobile edit source contract passed')
```

- [ ] **Step 2: Run the UI source contract and confirm RED**

Run:

```bash
node scripts/timesheet-mobile-edit-source-test.mjs
```

Expected: FAIL because the current monthly page renders only a horizontally scrollable table and has no delete button.

- [ ] **Step 3: Add delete action to the editor**

In `TimesheetMonthlyPage.jsx`, add:

```jsx
async function deleteEditor() {
  if (!editor?.id) return
  const confirmed = window.confirm('Diesen Stundenzettel-Eintrag wirklich löschen? Der Dienstplan und das Stempelprotokoll bleiben unverändert.')
  if (!confirmed) return
  setBusy('delete')
  setNotice(null)
  try {
    await requestJson('/api/timesheets', {
      method: 'DELETE',
      body: JSON.stringify({ action: 'manual-delete', id: editor.id, reason: editor.reason || 'Stundenzettel gelöscht' }),
    })
    setEditor(null)
    setNotice({ tone: 'success', text: 'Stundenzettel-Eintrag wurde gelöscht.' })
    await loadTimesheet()
  } catch (error) {
    setNotice({ tone: 'error', text: error.message })
  } finally {
    setBusy('')
  }
}
```

In the editor button row render:

```jsx
<button className="primary-button" disabled={busy === 'save'}>{busy === 'save' ? 'Wird gespeichert …' : 'Speichern'}</button>
{editor.mode === 'edit' && <button className="secondary-button danger-button" type="button" disabled={busy === 'delete'} onClick={deleteEditor}>{busy === 'delete' ? 'Wird gelöscht …' : 'Löschen'}</button>}
<button className="secondary-button" type="button" onClick={() => setEditor(null)}>Schließen</button>
```

Do not delete from schedule or Attendance APIs.

- [ ] **Step 4: Add mobile card markup while keeping desktop table**

Wrap the existing table section with:

```jsx
<div className="timesheet-desktop-table table-scroll">...</div>
```

Add before it:

```jsx
<div className="timesheet-mobile-list">
  {rows.length === 0 && <div className="timesheet-empty">Für den ausgewählten Zeitraum sind keine Stundenzettel-Einträge vorhanden.</div>}
  {rows.map((row) => <article className="timesheet-mobile-card" key={`mobile-${row.id}`}>
    <header><strong>{row.employeeName}</strong><span>{formatDate(row.workDate)}</span></header>
    <div className="timesheet-values">
      <div><span>Beginn</span><strong>{row.start}</strong></div>
      <div><span>Ende</span><strong>{row.end}</strong></div>
      <div><span>Pause</span><strong>{row.pauseMinutes} Min.</strong></div>
      <div><span>Dauer</span><strong>{formatDuration(row.netMinutes)}</strong></div>
      <div className="timesheet-wide-value"><span>Bereich</span><strong>{row.workArea || '–'}</strong></div>
      <div className="timesheet-wide-value"><span>Einsatzort</span><strong>{row.location || '–'}</strong></div>
    </div>
    <footer><button className="secondary-button" type="button" onClick={() => openExisting(row)}>Bearbeiten</button></footer>
  </article>)}
</div>
```

- [ ] **Step 5: Add responsive CSS**

In `timesheet.css`, preserve existing card styles and add:

```css
.timesheet-mobile-list { display: grid; gap: 12px; }
.timesheet-mobile-card { border: 1px solid var(--border, #2b3238); border-radius: 16px; padding: 16px; background: var(--surface-soft, rgba(255,255,255,.025)); display: grid; gap: 14px; }
.timesheet-mobile-card header, .timesheet-mobile-card footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.danger-button { border-color: rgba(220, 80, 80, .65); }

@media (min-width: 721px) {
  .timesheet-mobile-list { display: none; }
}

@media (max-width: 720px) {
  .timesheet-desktop-table { display: none; }
  .timesheet-mobile-list { display: grid; }
  .timesheet-mobile-card footer > button { width: 100%; }
  .timesheet-editor .button-row { display: grid; grid-template-columns: 1fr; }
  .timesheet-editor .button-row > button { width: 100%; }
}
```

- [ ] **Step 6: Run source contract and confirm GREEN**

Run:

```bash
node scripts/timesheet-mobile-edit-source-test.mjs
```

Expected: PASS.

- [ ] **Step 7: Extend Playwright with edit/save/delete mobile behavior**

In `tests/e2e/timesheet-monthly.spec.mjs`, extend the existing test route state with `deletedBody = null`, and in `/api/timesheets` route handling add:

```js
if (route.request().method() === 'DELETE') {
  deletedBody = route.request().postDataJSON()
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true, id: deletedBody.id, suppressed: true }) })
}
```

After the existing edit/save assertion, add a separate mobile-focused test that:

```js
await page.setViewportSize({ width: 390, height: 844 })
await expect(page.locator('.timesheet-mobile-card')).toBeVisible()
await expect(page.locator('.timesheet-desktop-table')).toBeHidden()
await page.locator('.timesheet-mobile-card').getByRole('button', { name: 'Bearbeiten' }).click()
await expect(page.getByLabel('Pause in Minuten')).toBeVisible()
await page.getByLabel('Pause in Minuten').fill('30')
await page.getByRole('button', { name: 'Speichern' }).click()
```

Then reopen the same mocked row, accept the confirmation dialog and click Löschen:

```js
page.once('dialog', (dialog) => dialog.accept())
await page.getByRole('button', { name: 'Löschen' }).click()
await expect.poll(() => deletedBody?.action).toBe('manual-delete')
expect(deletedBody.id).toBe('ts-1')
```

Also keep `attendanceHistoryReads === 0`.

- [ ] **Step 8: Run the focused Playwright test**

Run:

```bash
npx playwright test tests/e2e/timesheet-monthly.spec.mjs --project=chromium
```

Expected: PASS.

- [ ] **Step 9: Wire the source test into monthly verification**

Append:

```js
await import('./timesheet-mobile-edit-source-test.mjs')
```

before the final log in `scripts/verify-timesheet-monthly-freeze.mjs`.

- [ ] **Step 10: Commit Task 4**

```bash
git add frontend/src/TimesheetMonthlyPage.jsx frontend/src/timesheet.css scripts/timesheet-mobile-edit-source-test.mjs tests/e2e/timesheet-monthly.spec.mjs scripts/verify-timesheet-monthly-freeze.mjs
git commit -m "feat: make mobile timesheet editing explicit"
```

---

### Task 5: Add a visible restore path for suppressed schedule rows while the month is open

**Files:**
- Modify: `netlify/functions/timesheets.mts`
- Modify: `netlify/functions/_shared/timesheet-repository.mts`
- Modify: `frontend/src/TimesheetMonthlyPage.jsx`
- Modify: `tests/e2e/timesheet-monthly.spec.mjs`
- Create: `scripts/timesheet-restore-ui-source-test.mjs`
- Modify: `scripts/verify-timesheet-monthly-freeze.mjs`

**Interfaces:**
- `GET /api/timesheets` returns `suppressed` metadata separately from visible `entries`, limited to the selected range/user.
- Suppressed rows are not counted in total hours and not exported.
- UI shows a compact `Gelöschte Dienstplan-Einträge` section only when suppressions exist.
- Each suppressed schedule row has `Dienstplan übernehmen` button.
- Restore is disabled/rejected after the monthly cutoff.

- [ ] **Step 1: Write the failing restore UI/API source contract**

Create `scripts/timesheet-restore-ui-source-test.mjs`:

```js
import fs from 'node:fs'
import assert from 'node:assert/strict'

const repo = fs.readFileSync('netlify/functions/_shared/timesheet-repository.mts', 'utf8')
const api = fs.readFileSync('netlify/functions/timesheets.mts', 'utf8')
const ui = fs.readFileSync('frontend/src/TimesheetMonthlyPage.jsx', 'utf8')
assert.match(repo, /export async function listSuppressedTimesheetEntries/)
assert.match(api, /suppressedEntries/)
assert.match(ui, /Gelöschte Dienstplan-Einträge/)
assert.match(ui, /Dienstplan übernehmen/)
assert.match(ui, /action:\s*'restore-schedule'/)
console.log('timesheet restore UI source contract passed')
```

- [ ] **Step 2: Run the restore contract and confirm RED**

Run:

```bash
node scripts/timesheet-restore-ui-source-test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add a suppressed-row listing repository function**

In `timesheet-repository.mts`, add:

```ts
export async function listSuppressedTimesheetEntries(filters: { from: string; to: string; employeeUserId?: string }) {
  const params: unknown[] = [filters.from, filters.to]
  let employeeClause = ''
  if (filters.employeeUserId) {
    params.push(filters.employeeUserId)
    employeeClause = ` AND employee_user_id = $${params.length}`
  }
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM timesheet_entries
      WHERE work_date BETWEEN $1::date AND $2::date
        AND suppressed = true
        AND schedule_shift_id IS NOT NULL${employeeClause}
      ORDER BY work_date, start_time, employee_name, id`,
    params,
  )
  return result.rows.map((row) => mapTimesheetEntryRow(row))
}
```

- [ ] **Step 4: Return suppressions from GET `/api/timesheets`**

Import `listSuppressedTimesheetEntries`, then in the GET branch load it with the same filters as visible entries and return:

```ts
return json({ entries, suppressedEntries, months })
```

- [ ] **Step 5: Render suppressed rows and restore button in the UI**

Add state:

```jsx
const [suppressedRows, setSuppressedRows] = useState([])
```

Set it in `loadTimesheet()` from `data.suppressedEntries || []`.

Add:

```jsx
async function restoreScheduleRow(row) {
  setBusy(`restore-${row.id}`)
  setNotice(null)
  try {
    await requestJson('/api/timesheets', {
      method: 'POST',
      body: JSON.stringify({ action: 'restore-schedule', id: row.id, reason: 'Dienstplan wieder in Stundenzettel übernommen' }),
    })
    setNotice({ tone: 'success', text: 'Dienstplan-Eintrag wurde wieder in den Stundenzettel übernommen.' })
    await loadTimesheet()
  } catch (error) {
    setNotice({ tone: 'error', text: error.message })
  } finally {
    setBusy('')
  }
}
```

Render only when `suppressedRows.length > 0`:

```jsx
<section className="panel timesheet-suppressed">
  <div className="page-heading"><div><h2>Gelöschte Dienstplan-Einträge</h2><p>Diese Einträge bleiben aus dem Stundenzettel entfernt, bis sie bewusst wieder übernommen werden.</p></div></div>
  <div className="timesheet-card-grid">
    {suppressedRows.map((row) => <article className="timesheet-card" key={`suppressed-${row.id}`}>
      <header><strong>{row.employeeName}</strong><span>{formatDate(row.workDate)}</span></header>
      <div>{row.start}–{row.end} · {row.workArea || '–'} · {row.location || '–'}</div>
      <footer><button className="secondary-button" type="button" disabled={busy === `restore-${row.id}`} onClick={() => restoreScheduleRow(row)}>Dienstplan übernehmen</button></footer>
    </article>)}
  </div>
</section>
```

- [ ] **Step 6: Extend Playwright to cover restore without Attendance reads**

In the mocked GET response include one `suppressedEntries` row. Handle POST `restore-schedule` by capturing its body and returning a schedule row. Assert:

```js
await expect(page.getByText('Gelöschte Dienstplan-Einträge')).toBeVisible()
await page.getByRole('button', { name: 'Dienstplan übernehmen' }).click()
await expect.poll(() => restoreBody?.action).toBe('restore-schedule')
await expect.poll(() => attendanceHistoryReads).toBe(0)
```

- [ ] **Step 7: Run source test and focused E2E**

Run:

```bash
node scripts/timesheet-restore-ui-source-test.mjs
npx playwright test tests/e2e/timesheet-monthly.spec.mjs --project=chromium
```

Expected: PASS.

- [ ] **Step 8: Wire restore test into monthly verifier and commit**

Append:

```js
await import('./timesheet-restore-ui-source-test.mjs')
```

Then run:

```bash
node scripts/verify-timesheet-monthly-freeze.mjs
```

Expected: PASS.

Commit:

```bash
git add netlify/functions/timesheets.mts netlify/functions/_shared/timesheet-repository.mts frontend/src/TimesheetMonthlyPage.jsx tests/e2e/timesheet-monthly.spec.mjs scripts/timesheet-restore-ui-source-test.mjs scripts/verify-timesheet-monthly-freeze.mjs
git commit -m "feat: allow explicit timesheet schedule restore"
```

---

### Task 6: Final integration verification and PR preparation

**Files:**
- Modify only if a final-state verifier needs registration: `package.json` or `scripts/verify-timesheet-monthly-freeze.mjs`
- No production feature files should change in this task unless a failing verification demonstrates a real defect.

**Interfaces:**
- All earlier tasks are integrated.
- No production deployment occurs in this task.

- [ ] **Step 1: Retrieve current Netlify coding context again**

Read Netlify Functions and Database coding context once more before final review to catch any platform requirement that changed during implementation.

- [ ] **Step 2: Run the complete repository verifier**

Run:

```bash
npm run verify
```

Expected: exit code 0 with all legacy, v2, unified and database checks passing.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: exit code 0 and frontend assets generated successfully.

- [ ] **Step 4: Run the complete browser suite**

Run:

```bash
npm run test:e2e
```

Expected: 0 failures across the configured desktop/mobile browser projects.

- [ ] **Step 5: Re-run the focused original-risk tests after the full suite**

Run:

```bash
node scripts/verify-timesheet-monthly-freeze.mjs
npx playwright test tests/e2e/timesheet-monthly.spec.mjs
```

Expected: PASS, including:
- Stundenzettel reads no Attendance history.
- mobile `Bearbeiten` is visible without horizontal scrolling.
- save/delete/restore requests use only `/api/timesheets`.
- deleted schedule-linked row stays suppressed until explicit restore.
- PDF contract contains old Habun layout tokens and no Attendance source.

- [ ] **Step 6: Review the final diff against the approved spec**

Verify all of these before opening the PR:

```text
PDF title = Stundenzettel
Gold table + Gesamtdauer + Anmerkungen
Central translucent logo watermark; no black logo box
Central company settings used
One employee starts per page
Blank calendar dates included
Status only Dienstplan/Manuell
No Attendance source in Stundenzettel or PDF
Mobile edit button visible
Editor changes date/start/end/pause/workArea/location
Save/Delete/Close visible
Schedule-linked delete is suppression, not Dienstplan deletion
Manual-only delete is isolated
Explicit restore only while schedule-sync window is open
Closed-month manual editing remains allowed
No Berichte navigation item reintroduced
```

- [ ] **Step 7: Commit any verification-only registration change, if one was necessary**

If no file changed, do not create an empty commit. If a verifier registration changed:

```bash
git add package.json scripts/verify-timesheet-monthly-freeze.mjs
git commit -m "test: finalize timesheet PDF and mobile edit verification"
```

- [ ] **Step 8: Create a Pull Request against `main`**

PR title:

```text
Restore Habun timesheet PDF and mobile editing
```

PR body must state:

```text
- Restores the earlier Habun portrait/gold Stundenzettel PDF design while keeping the new independent timesheet data source.
- Adds mobile card editing with visible Bearbeiten/Speichern/Löschen controls.
- Schedule-linked deletes are soft-suppressed so the Dienstplan is never changed and open-month sync cannot silently recreate them.
- Adds explicit schedule restore while the correction window is open.
- Attendance/Stempel data remains fully separate.
- Full verify, build and Playwright E2E must be green before merge.
```

- [ ] **Step 9: Stop before merge**

Do not merge or trigger production deployment until the human user explicitly chooses the integration option after the verified PR is ready.
