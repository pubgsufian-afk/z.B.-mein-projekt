# Attendance Comparison and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep stamp/attendance data completely separate from Stundenzettel while giving management a dedicated place to review actual stamp sessions, compare them with the persisted timesheet, and export the stamp data separately as PDF/XLSX.

**Architecture:** Create a read-only comparison layer that aggregates persisted `timesheet_entries` and `attendance_events` independently by employee/day. A new management-only page reads this comparison API and a separate attendance-report endpoint exports actual stamp sessions. Neither endpoint writes to timesheets or schedules.

**Tech Stack:** React 19, JavaScript/ESM, TypeScript Netlify Functions, `@neondatabase/serverless`, `@netlify/database`, pdf-lib, ExcelJS, Node tests, Playwright E2E.

## Global Constraints

- Attendance events never change Stundenzettel or schedule data.
- Comparison is informational only.
- Stempelprotokoll export is separate from Stundenzettel PDF/XLSX.
- Management roles may view all employee comparison/export data; employee access remains limited to existing own attendance rules.
- A day with multiple scheduled/timesheet shifts and one continuous stamp session must not appear as duplicate paid hours; comparison uses daily totals and boundaries for the summary.
- Missing clock-in/clock-out must be shown as a warning, not repaired automatically.
- No automatic writes from comparison results.
- Start from then-current `main` after the monthly-timesheet plan is merged; do not implement comparison against the old merged-timesheet model.
- Preserve any merged performance work from PR #108.

---

### Task 1: Build pure attendance-session and daily comparison utilities

**Files:**
- Create: `netlify/functions/_shared/attendance-comparison-core.mts`
- Create: `scripts/attendance-comparison-core-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `buildAttendanceSessions(events, adjustments)` returns closed/open stamp sessions.
- `summarizeTimesheetDay(rows)` returns earliest start, latest end, pause total, net total.
- `summarizeAttendanceDay(sessions)` returns earliest clock-in, latest clock-out, break total, net total, open-session flag.
- `compareDailyTimesheetToAttendance(timesheetRows, sessions)` returns one comparison record per `userId + date`.

- [ ] **Step 1: Write failing tests covering multi-shift days**

```js
import assert from 'node:assert/strict'
import { compareDailyTimesheetToAttendance } from '../netlify/functions/_shared/attendance-comparison-core.mts'

const timesheet = [
  { employeeUserId: 'u1', employeeName: 'A', workDate: '2026-08-10', start: '10:00', end: '17:00', pauseMinutes: 60, netMinutes: 360 },
  { employeeUserId: 'u1', employeeName: 'A', workDate: '2026-08-10', start: '18:00', end: '22:00', pauseMinutes: 0, netMinutes: 240 },
]
const sessions = [
  { userId: 'u1', date: '2026-08-10', clockInAt: '2026-08-10T08:00:00.000Z', clockOutAt: '2026-08-10T20:00:00.000Z', breakMinutes: 60, netMinutes: 660, open: false },
]
const result = compareDailyTimesheetToAttendance(timesheet, sessions)
assert.equal(result.length, 1)
assert.equal(result[0].timesheetNetMinutes, 600)
assert.equal(result[0].attendanceNetMinutes, 660)
assert.equal(result[0].differenceMinutes, 60)
console.log('attendance comparison core passed')
```

Also test: attendance-only day, timesheet-only day, open attendance session, and two separate actual sessions on one day.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types scripts/attendance-comparison-core-test.mjs`
Expected: FAIL because core module does not exist.

- [ ] **Step 3: Implement deterministic day grouping**

Use key `${userId}|${date}`. Do not match individual schedule IDs for the daily summary. Keep source session detail in a nested `sessions` array for inspection.

Returned comparison shape:

```ts
{
  userId: string,
  employeeName: string,
  date: string,
  timesheetStart: string | null,
  timesheetEnd: string | null,
  timesheetPauseMinutes: number,
  timesheetNetMinutes: number,
  attendanceStart: string | null,
  attendanceEnd: string | null,
  attendancePauseMinutes: number,
  attendanceNetMinutes: number,
  differenceMinutes: number,
  status: 'match' | 'different' | 'missing-attendance' | 'attendance-only' | 'open-attendance'
}
```

- [ ] **Step 4: Run tests**

Run: `node --experimental-strip-types scripts/attendance-comparison-core-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/attendance-comparison-core.mts scripts/attendance-comparison-core-test.mjs package.json
git commit -m "feat: add daily attendance comparison core"
```

---

### Task 2: Add management comparison API

**Files:**
- Create: `netlify/functions/attendance-comparison.mts`
- Create: `scripts/attendance-comparison-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `GET /api/attendance-comparison?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...`
- Reads `attendance_events` + latest `attendance_adjustments` and persisted `timesheet_entries`.
- Returns `{ comparisons, sessions }`.

- [ ] **Step 1: Add failing source contract**

```js
assert.match(source, /attendance_events/)
assert.match(source, /timesheet_entries/)
assert.match(source, /compareDailyTimesheetToAttendance/)
assert.match(source, /owner.*admin.*manager|MANAGEMENT/)
assert.doesNotMatch(source, /UPDATE timesheet_entries|DELETE FROM timesheet_entries|INSERT INTO timesheet_entries/)
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/attendance-comparison-source-test.mjs`
Expected: FAIL because endpoint does not exist.

- [ ] **Step 3: Implement authenticated bounded reads**

Validate range with `YYYY-MM-DD`, `to >= from`, and a maximum of 62 days. Use portal-role auth. Filter by `userId` when provided.

- [ ] **Step 4: Build sessions then comparison**

Read enough next-day events to close overnight sessions, but assign sessions to the clock-in Berlin date. Return warning status for an open session instead of inventing an end time.

- [ ] **Step 5: Run source/core tests**

```bash
node scripts/attendance-comparison-source-test.mjs
node --experimental-strip-types scripts/attendance-comparison-core-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/attendance-comparison.mts scripts/attendance-comparison-source-test.mjs package.json
git commit -m "feat: add attendance comparison api"
```

---

### Task 3: Create separate stamp-session PDF/XLSX export

**Files:**
- Create: `netlify/functions/attendance-reports.mts`
- Create: `scripts/attendance-report-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `POST /api/attendance-reports` body `{ from, to, userIds, format: 'pdf'|'xlsx' }`.
- Export contains actual clock-in, clock-out, actual/adjusted break, net duration, location status/object reference, and warning for open/incomplete session.
- It does not read or include `timesheet_entries` unless a future explicitly separate comparison export is requested.

- [ ] **Step 1: Write failing export source test**

```js
assert.match(source, /attendance_events/)
assert.match(source, /attendance_adjustments/)
assert.match(source, /pdf-lib/)
assert.match(source, /exceljs/)
assert.doesNotMatch(source, /timesheet_entries/)
assert.doesNotMatch(source, /schedule_shifts/)
```

- [ ] **Step 2: Run and confirm RED**

Run: `node scripts/attendance-report-source-test.mjs`
Expected: FAIL because endpoint does not exist.

- [ ] **Step 3: Implement shared stamp-row loader**

Reuse `buildAttendanceSessions` from comparison core. Never duplicate pairing logic in the report file.

- [ ] **Step 4: Implement PDF**

Columns: Mitarbeiter, Datum, Einstempeln, Ausstempeln, Pause, Netto, Standortstatus, Hinweis. Use existing company branding helpers where practical, but do not mix in Stundenzettel wording.

- [ ] **Step 5: Implement XLSX**

One row per actual session. Duration cells use numeric decimal hours or minutes consistently; keep display time columns as strings.

- [ ] **Step 6: Run report tests**

Run: `node scripts/attendance-report-source-test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/attendance-reports.mts scripts/attendance-report-source-test.mjs package.json
git commit -m "feat: add separate stamp protocol exports"
```

---

### Task 4: Add a separate management page “Stempelprotokoll”

**Files:**
- Create: `frontend/src/AttendanceReviewPage.jsx`
- Modify: `frontend/src/App.jsx`
- Create: `scripts/attendance-review-page-source-test.mjs`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Management navigation gets `Stempelprotokoll` as a page separate from `Stundenzettel`.
- Page calls `/api/attendance-comparison` for display.
- Page calls `/api/attendance-reports` for separate PDF/XLSX download.

- [ ] **Step 1: Add failing source test**

Require `AttendanceReviewPage`, `/api/attendance-comparison`, `/api/attendance-reports`, and assert the new page does not call `/api/timesheets` with write methods.

- [ ] **Step 2: Add failing browser test**

Mock comparison response with one matching day and one `different` day. Assert management can navigate to `Stempelprotokoll`, sees both rows, and `Stundenzettel` remains a different navigation destination.

- [ ] **Step 3: Implement filters**

Date from/to, employee select, refresh button. Use the existing registrations cache behavior from latest main where available; preserve PR #108 performance primitives.

- [ ] **Step 4: Implement comparison table/cards**

Show:
- Datum
- Stundenzettel Beginn/Ende/Netto
- Stempel Beginn/Ende/Netto
- Differenz
- Status

Use `+60 Min.` / `-30 Min.` display and clear warning text for open/missing stamps.

- [ ] **Step 5: Add separate download buttons**

Buttons: `Stempelprotokoll PDF` and `Stempelprotokoll Excel`. They post only to `/api/attendance-reports`.

- [ ] **Step 6: Run source and targeted E2E tests**

```bash
node scripts/attendance-review-page-source-test.mjs
npx playwright test tests/e2e/unified-portal.spec.mjs --grep "Stempelprotokoll"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/AttendanceReviewPage.jsx frontend/src/App.jsx scripts/attendance-review-page-source-test.mjs tests/e2e/unified-portal.spec.mjs package.json
git commit -m "feat: add separate stamp review page"
```

---

### Task 5: Prove Stundenzettel and stamp workflow cannot affect each other

**Files:**
- Create: `scripts/timesheet-attendance-separation-test.mjs`
- Modify: `package.json`
- Modify: `tests/e2e/unified-portal.spec.mjs`

**Interfaces:**
- This is a cross-boundary regression gate, not a new product API.

- [ ] **Step 1: Add source boundary assertions**

Assert:
- `TimesheetPage.jsx` has no attendance-history request.
- `timesheet-reports.mts` has no attendance query.
- `AttendanceReviewPage.jsx` has no timesheet write request.
- `attendance-reports.mts` has no timesheet query.

- [ ] **Step 2: Add E2E separation scenario**

Mock one timesheet value and a very different stamp value. Assert:
1. Stundenzettel shows only the timesheet value.
2. Stempelprotokoll shows the stamp value and difference.
3. Returning to Stundenzettel still shows the unchanged timesheet value.

- [ ] **Step 3: Run tests**

```bash
node scripts/timesheet-attendance-separation-test.mjs
npx playwright test tests/e2e/unified-portal.spec.mjs --grep "getrennt|Stempelprotokoll"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/timesheet-attendance-separation-test.mjs tests/e2e/unified-portal.spec.mjs package.json
git commit -m "test: lock timesheet attendance separation"
```

---

### Task 6: Full verification and release

- [ ] **Step 1: Run complete verification**

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npm run test:e2e
```

Expected: all exit 0.

- [ ] **Step 2: Review endpoint boundaries**

```bash
rg "attendance_events" netlify/functions/timesheets.mts netlify/functions/timesheet-reports.mts frontend/src/TimesheetPage.jsx
rg "UPDATE timesheet_entries|DELETE FROM timesheet_entries|INSERT INTO timesheet_entries" netlify/functions/attendance-comparison.mts netlify/functions/attendance-reports.mts
```

Expected: first command finds no attendance dependency in timesheet path; second finds no timesheet writes in stamp path.

- [ ] **Step 3: Open PR only after monthly-timesheet core is already on `main`**

If PR #108 or another active change has modified App/Timesheet files, rebase from latest `main` and preserve those changes.

- [ ] **Step 4: Require green GitHub verification and Netlify previews**

Do not use the production site as the test harness.

- [ ] **Step 5: Merge and allow one normal production deploy**

- [ ] **Step 6: Production smoke-check with read-only actions**

Verify Stundenzettel values do not change when opening Stempelprotokoll and that the separate export buttons return the correct file types.
