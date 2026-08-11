# Timesheet Monthly Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stundenzettel an independent monthly record sourced from published schedule shifts, synchronized only through the 10th of the following month, while allowing audited manual corrections forever without changing the schedule.

**Architecture:** Store dedicated timesheet months and rows in the Netlify production database. All schedule mutation paths call one synchronization service that checks the Europe/Berlin correction deadline before touching timesheet rows and never overwrites a manual override. The Timesheet page and PDF/XLSX reports read only the dedicated timesheet store; attendance events are removed from this data path entirely.

**Tech Stack:** React 19, JavaScript/ESM, TypeScript Netlify Functions, `@netlify/database`, PostgreSQL 17, pdf-lib, ExcelJS, Node source/unit tests, Playwright E2E.

## Global Constraints

- Stundenzettel is based only on published schedule shifts; `draft` rows never appear.
- Attendance/stamp events never create, overwrite, merge, or delete Stundenzettel rows.
- A month remains schedule-synchronized through the 10th of the following month, inclusive.
- At 00:00 Europe/Berlin on the 11th, later schedule changes must no longer affect that month even if a background close job has not run.
- Manual timesheet changes affect only the timesheet, never the schedule.
- A manually overridden row must not be silently overwritten by later schedule synchronization.
- Closed months may still be manually corrected by authorized management roles with a reason and audit trail.
- Existing portal roles remain authoritative; no permission broadening.
- Do not automatically rebuild already-closed pre-feature months from later-modified historical schedules.
- Start implementation from the then-current `main`. PR #108 currently touches `frontend/src/TimesheetPage.jsx` and performance code, so do not implement from this spec branch or overwrite #108 changes.
- Minimize Netlify production use: source/unit/E2E checks first, one final production release only after all checks pass.

---

### Task 1: Add persistent monthly timesheet schema

**Files:**
- Create: `netlify/database/migrations/20260811233000_create-timesheet-monthly-snapshots/migration.sql`
- Create: `scripts/timesheet-month-schema-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces table `timesheet_months` keyed by `month_key` (`YYYY-MM`).
- Produces table `timesheet_entries` keyed by `id`, with optional unique `schedule_shift_id`.
- Produces table `timesheet_audit_log` for manual edits, schedule sync changes, and month close events.

- [ ] **Step 1: Write the failing schema contract test**

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile('netlify/database/migrations/20260811233000_create-timesheet-monthly-snapshots/migration.sql', 'utf8')
for (const needle of [
  'CREATE TABLE timesheet_months',
  'month_key text PRIMARY KEY',
  'correction_deadline date NOT NULL',
  'CREATE TABLE timesheet_entries',
  'schedule_shift_id text',
  'manual_override boolean NOT NULL DEFAULT false',
  "source text NOT NULL DEFAULT 'schedule'",
  'CREATE UNIQUE INDEX timesheet_entries_schedule_shift_idx',
  'CREATE TABLE timesheet_audit_log',
]) assert.ok(sql.includes(needle), `missing ${needle}`)
console.log('timesheet month schema contract passed')
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node scripts/timesheet-month-schema-test.mjs`
Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create the migration**

Use this schema shape:

```sql
CREATE TABLE timesheet_months (
  month_key text PRIMARY KEY,
  correction_deadline date NOT NULL,
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_months_key_check CHECK (month_key ~ '^\\d{4}-\\d{2}$')
);

CREATE TABLE timesheet_entries (
  id text PRIMARY KEY,
  schedule_shift_id text,
  employee_user_id text NOT NULL,
  employee_name text NOT NULL,
  work_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  pause_minutes integer NOT NULL DEFAULT 0,
  net_minutes integer NOT NULL DEFAULT 0,
  location text NOT NULL DEFAULT '',
  work_area text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'schedule',
  manual_override boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  CONSTRAINT timesheet_entries_pause_check CHECK (pause_minutes >= 0),
  CONSTRAINT timesheet_entries_net_check CHECK (net_minutes >= 0),
  CONSTRAINT timesheet_entries_source_check CHECK (source IN ('schedule','manual'))
);

CREATE UNIQUE INDEX timesheet_entries_schedule_shift_idx
  ON timesheet_entries(schedule_shift_id)
  WHERE schedule_shift_id IS NOT NULL;
CREATE INDEX timesheet_entries_month_employee_idx
  ON timesheet_entries(work_date, employee_user_id, start_time);

CREATE TABLE timesheet_audit_log (
  id text PRIMARY KEY,
  occurred_at timestamp with time zone NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  entry_id text,
  month_key text NOT NULL,
  reason text,
  before_data jsonb,
  after_data jsonb
);
CREATE INDEX timesheet_audit_month_time_idx
  ON timesheet_audit_log(month_key, occurred_at DESC);
```

- [ ] **Step 4: Add the schema test to `verify:unified` and run it**

Run: `node scripts/timesheet-month-schema-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/database/migrations/20260811233000_create-timesheet-monthly-snapshots/migration.sql scripts/timesheet-month-schema-test.mjs package.json
git commit -m "feat: add monthly timesheet snapshot schema"
```

---

### Task 2: Implement Europe/Berlin correction-window rules

**Files:**
- Create: `netlify/functions/_shared/timesheet-month-policy.mts`
- Create: `scripts/timesheet-month-policy-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `monthKeyForDate(date: string): string`.
- Produces `correctionDeadlineForMonth(monthKey: string): string` returning the 10th of the following month as `YYYY-MM-DD`.
- Produces `isTimesheetScheduleSyncOpen(monthKey: string, now: Date): boolean` using Europe/Berlin calendar date, not UTC date.

- [ ] **Step 1: Write failing boundary tests**

```js
import assert from 'node:assert/strict'
import { correctionDeadlineForMonth, isTimesheetScheduleSyncOpen } from '../netlify/functions/_shared/timesheet-month-policy.mts'

assert.equal(correctionDeadlineForMonth('2026-08'), '2026-09-10')
assert.equal(isTimesheetScheduleSyncOpen('2026-08', new Date('2026-09-10T21:59:59Z')), true)
assert.equal(isTimesheetScheduleSyncOpen('2026-08', new Date('2026-09-10T22:00:00Z')), false)
assert.equal(correctionDeadlineForMonth('2026-12'), '2027-01-10')
console.log('timesheet month policy passed')
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types scripts/timesheet-month-policy-test.mjs`
Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the policy without UTC shortcuts**

```ts
const MONTH_KEY = /^\d{4}-\d{2}$/

export function correctionDeadlineForMonth(monthKey: string) {
  if (!MONTH_KEY.test(monthKey)) throw new TypeError('Ungültiger Monat.')
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 10, 12, 0, 0))
  return next.toISOString().slice(0, 10)
}

export function berlinDateKey(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isTimesheetScheduleSyncOpen(monthKey: string, now = new Date()) {
  return berlinDateKey(now) <= correctionDeadlineForMonth(monthKey)
}
```

Also export `monthKeyForDate` with strict `YYYY-MM-DD` validation.

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types scripts/timesheet-month-policy-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/timesheet-month-policy.mts scripts/timesheet-month-policy-test.mjs package.json
git commit -m "feat: enforce timesheet correction deadline"
```

---

### Task 3: Build the timesheet repository and schedule synchronization service

**Files:**
- Create: `netlify/functions/_shared/timesheet-repository.mts`
- Create: `netlify/functions/_shared/timesheet-schedule-sync.mts`
- Create: `scripts/timesheet-schedule-sync-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `listTimesheetEntries({ from, to, employeeUserId? })` returns persisted timesheet rows only.
- `syncPublishedScheduleShift(shift, actorId, now)` creates/updates/removes the linked timesheet row only when the month is still schedule-open.
- `removeScheduleShiftFromTimesheet(shiftId, shiftDate, actorId, now)` removes a linked schedule row only while open and only when `manual_override=false`.
- `syncPublishedScheduleRange(from, to, actorId, now)` is idempotent and creates missing rows for currently open months only.

- [ ] **Step 1: Write failing pure synchronization tests with an in-memory repository stub**

Test these cases explicitly:

```js
assert.equal(syncDecision({ monthOpen: true, status: 'published', manualOverride: false }), 'upsert')
assert.equal(syncDecision({ monthOpen: false, status: 'published', manualOverride: false }), 'ignore')
assert.equal(syncDecision({ monthOpen: true, status: 'published', manualOverride: true }), 'ignore')
assert.equal(syncDecision({ monthOpen: true, status: 'draft', manualOverride: false }), 'delete')
```

Also assert net minutes for `10:00-17:00` with 60 pause equals 360.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types scripts/timesheet-schedule-sync-test.mjs`
Expected: FAIL because the sync module does not exist.

- [ ] **Step 3: Implement row mapping and idempotent upsert**

The mapped schedule row must be:

```ts
{
  scheduleShiftId: shift.id,
  employeeUserId: shift.employeeUserId,
  employeeName: shift.employeeName,
  workDate: shift.date,
  start: shift.start,
  end: shift.end,
  pauseMinutes: shift.pauseMinutes,
  netMinutes: plannedNetMinutes(shift.date, shift.start, shift.end, shift.pauseMinutes),
  location: shift.location,
  workArea: shift.workArea,
  source: 'schedule',
  manualOverride: false,
}
```

Repository upsert must use `ON CONFLICT (schedule_shift_id) WHERE schedule_shift_id IS NOT NULL DO UPDATE` and include `AND timesheet_entries.manual_override = false` semantics by checking the existing row before mutation.

- [ ] **Step 4: Implement open-range bootstrap**

`syncPublishedScheduleRange` must:
1. Read published shifts from `schedule_shifts`.
2. Skip any month whose policy is closed at `now`.
3. Upsert schedule rows.
4. Remove stale linked rows for open months only when the referenced shift no longer exists and `manual_override=false`.
5. Never touch closed months.

- [ ] **Step 5: Run focused tests**

Run: `node --experimental-strip-types scripts/timesheet-schedule-sync-test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/timesheet-repository.mts netlify/functions/_shared/timesheet-schedule-sync.mts scripts/timesheet-schedule-sync-test.mjs package.json
git commit -m "feat: synchronize open timesheets from published schedule"
```

---

### Task 4: Connect every schedule mutation path to timesheet synchronization

**Files:**
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Modify: `netlify/functions/schedule-v2-neon.mts`
- Modify: `netlify/functions/schedule-assistant.mts`
- Create: `scripts/timesheet-schedule-hook-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Portal schedule create/update/delete and encrypted assistant create/update/delete must all trigger the same synchronization service.
- Week publication must materialize newly published rows.

- [ ] **Step 1: Add failing source-contract assertions**

The test must require calls to:

```js
syncPublishedScheduleShift
removeScheduleShiftFromTimesheet
syncPublishedScheduleRange
```

and must assert no direct `attendance_events` reference appears in the timesheet schedule-sync module.

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/timesheet-schedule-hook-source-test.mjs`
Expected: FAIL because schedule mutation files do not call the service.

- [ ] **Step 3: Wire portal mutations**

After a successful schedule shift create/update, call:

```ts
await syncPublishedScheduleShift(savedShift, current.userId, new Date())
```

After a successful delete, preserve the old shift date before deletion and call:

```ts
await removeScheduleShiftFromTimesheet(existing.id, existing.date, current.userId, new Date())
```

After a week is published, call `syncPublishedScheduleRange(weekStart, weekEnd, current.userId, new Date())`.

- [ ] **Step 4: Wire encrypted assistant mutations with actor `chatgpt`**

Use the same sync functions after successful assistant schedule changes. Do not create a second business-rule implementation.

- [ ] **Step 5: Run schedule regression tests plus new source test**

Run:

```bash
node scripts/timesheet-schedule-hook-source-test.mjs
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/schedule-neon-source-test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/schedule-v2-neon.mts netlify/functions/schedule-assistant.mts scripts/timesheet-schedule-hook-source-test.mjs package.json
git commit -m "feat: keep open timesheets in sync with schedule"
```

---

### Task 5: Add management timesheet API with permanent manual corrections

**Files:**
- Create: `netlify/functions/timesheets.mts`
- Create: `scripts/timesheet-api-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `GET /api/timesheets?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...` lists persisted rows.
- `POST /api/timesheets` action `manual-create` creates a manual row.
- `PATCH /api/timesheets` action `manual-update` changes one row and sets `manual_override=true`, `source='manual'`.
- `DELETE /api/timesheets` deletes one manually confirmed row with audit reason.
- Management roles: `owner`, `admin`, `manager`; employees cannot perform administrative edits.

- [ ] **Step 1: Write failing source tests for auth, origin protection, and no attendance dependency**

Require:

```js
assert.match(source, /currentPortalActor|requirePortalRole/)
assert.match(source, /verifyRequestOrigin/)
assert.match(source, /manual-update/)
assert.match(source, /manual_override/)
assert.match(source, /timesheet_audit_log/)
assert.doesNotMatch(source, /attendance_events/)
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/timesheet-api-source-test.mjs`
Expected: FAIL because endpoint does not exist.

- [ ] **Step 3: Implement GET with open-month materialization**

Before reading an open current/correction-window month, call `syncPublishedScheduleRange` for only the requested open dates. For closed months, do not bootstrap from schedule.

Return:

```json
{
  "entries": [],
  "months": [{"month":"2026-08","correctionDeadline":"2026-09-10","scheduleSyncOpen":true}]
}
```

- [ ] **Step 4: Implement manual update**

Validate `start`, `end`, integer `pauseMinutes >= 0`, and `pauseMinutes <= grossMinutes`. Save old/new JSON in `timesheet_audit_log`. Manual changes are allowed even when schedule sync is closed.

- [ ] **Step 5: Implement manual create/delete with reason**

Manual create uses `schedule_shift_id = NULL`, `source='manual'`, `manual_override=true`. Delete requires a non-empty reason and writes a deletion audit record before removing the row.

- [ ] **Step 6: Run endpoint source tests**

Run: `node scripts/timesheet-api-source-test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/timesheets.mts scripts/timesheet-api-source-test.mjs package.json
git commit -m "feat: add independent timesheet management api"
```

---

### Task 6: Make Stundenzettel UI read only the dedicated timesheet store

**Files:**
- Modify: `frontend/src/TimesheetPage.jsx`
- Remove timesheet-runtime dependency on: `frontend/src/timesheet-unified.js` where no longer needed by the page
- Create: `scripts/timesheet-independent-ui-source-test.mjs`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Timesheet page consumes `/api/timesheets` only for row values.
- Attendance history is not requested from TimesheetPage.
- Schedule entries are not merged client-side into timesheet rows.

- [ ] **Step 1: Add failing source assertions**

```js
assert.match(source, /\/api\/timesheets/)
assert.doesNotMatch(source, /\/api\/attendance\?resource=history/)
assert.doesNotMatch(source, /mergeTimesheetRows\(/)
assert.doesNotMatch(source, /buildActualSessions\(/)
```

- [ ] **Step 2: Add browser regression first**

Mock `/api/timesheets` with one persisted row and mock `/api/attendance` with a conflicting time. Navigate to Stundenzettel and assert the persisted timesheet value is shown and the conflicting attendance time is absent.

- [ ] **Step 3: Run tests and confirm RED**

Run source test and targeted Playwright test. Expected: FAIL on existing merge behavior.

- [ ] **Step 4: Replace actual/planned dual loading with one `loadTimesheet` request**

Keep management employee filter and date range. Editing calls the new timesheet API. UI labels should describe schedule-based Stundenzettel, not actual stamping.

- [ ] **Step 5: Preserve manual edit UX**

Existing edit dialog may stay visually similar, but its save payload must target `/api/timesheets` and include a reason. Do not call `/api/attendance-time-edit` or `/api/attendance-time-create` from Stundenzettel.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node scripts/timesheet-independent-ui-source-test.mjs
npx playwright test tests/e2e/unified-portal.spec.mjs --grep "Stundenzettel"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/TimesheetPage.jsx scripts/timesheet-independent-ui-source-test.mjs tests/e2e/unified-portal.spec.mjs package.json
git commit -m "feat: separate timesheet ui from attendance"
```

---

### Task 7: Rebuild Stundenzettel PDF/XLSX from persisted timesheet rows only

**Files:**
- Modify: `netlify/functions/timesheet-reports.mts`
- Create: `scripts/timesheet-report-independent-source-test.mjs`
- Modify: `scripts/timesheet-report-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Existing `POST /api/timesheet-reports` remains the Stundenzettel export endpoint.
- It queries `timesheet_entries`, not attendance events and not schedule API values.

- [ ] **Step 1: Add failing source test**

```js
assert.match(source, /timesheet_entries/)
assert.doesNotMatch(source, /attendance_events/)
assert.doesNotMatch(source, /loadSchedules|schedule-v2/)
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/timesheet-report-independent-source-test.mjs`
Expected: FAIL because reports still merge attendance and schedule.

- [ ] **Step 3: Replace report row loader**

Load rows with the same repository used by `/api/timesheets`; keep existing PDF branding, blank dates, employee grouping, monthly totals, and XLSX formatting.

- [ ] **Step 4: Add a regression fixture**

Fixture: one timesheet row `10:00-17:00`, 60 pause, and a conflicting attendance event. Exported report test must compute 6:00 hours and ignore attendance.

- [ ] **Step 5: Run report tests**

Run:

```bash
node scripts/timesheet-report-independent-source-test.mjs
node scripts/timesheet-report-source-test.mjs
node scripts/report-download-contract-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/timesheet-reports.mts scripts/timesheet-report-independent-source-test.mjs scripts/timesheet-report-source-test.mjs package.json
git commit -m "feat: export persisted timesheets only"
```

---

### Task 8: Bootstrap August 2026 safely and protect older months

**Files:**
- Create: `scripts/timesheet-bootstrap-policy-test.mjs`
- Modify: `netlify/functions/_shared/timesheet-schedule-sync.mts`
- Modify: `package.json`

**Interfaces:**
- On first production read after release, August 2026 may be materialized because it is open.
- Months already outside their correction window at release are never automatically rebuilt from schedule.

- [ ] **Step 1: Add failing bootstrap policy tests**

At `2026-08-11T21:30:00Z`, assert August 2026 can sync and July 2026 cannot.

- [ ] **Step 2: Run and confirm RED if current range sync does not enforce per-month policy**

Run: `node --experimental-strip-types scripts/timesheet-bootstrap-policy-test.mjs`.

- [ ] **Step 3: Enforce per-month skip before every backfill mutation**

Do not use a single range-level flag; each shift month must pass `isTimesheetScheduleSyncOpen`.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/timesheet-schedule-sync.mts scripts/timesheet-bootstrap-policy-test.mjs package.json
git commit -m "fix: protect closed timesheet months from backfill"
```

---

### Task 9: Full verification and one release

**Files:**
- Modify only if needed: repository verification scripts and finalizer ordering.

- [ ] **Step 1: Rebase/refresh from the then-current `main` before implementation PR**

If PR #108 has merged, ensure its Timesheet/read-cache changes are present. Do not overwrite its performance behavior.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npm run test:e2e
```

Expected: all commands exit 0.

- [ ] **Step 3: Review migration and business-rule boundaries**

Confirm with source search:

```bash
rg "attendance_events|mergeTimesheetRows|buildActualSessions" frontend/src/TimesheetPage.jsx netlify/functions/timesheet-reports.mts netlify/functions/timesheets.mts
```

Expected: no attendance-to-timesheet merge references in these files.

- [ ] **Step 4: Create PR and wait for GitHub/Netlify preview checks**

Do not merge while verify/build/E2E or deploy-preview is pending/failed.

- [ ] **Step 5: Merge only the green PR and allow one normal production deployment**

Do not trigger repeated manual Netlify deploys.

- [ ] **Step 6: Production read-only verification**

Verify August 2026 Stundenzettel rows are schedule-derived and that attendance events do not alter their values. Do not test by creating fake employee data in production.
