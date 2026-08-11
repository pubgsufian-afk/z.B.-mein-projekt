# Timesheet Close State and Manual Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the monthly-timesheet design by recording the first observed post-deadline close state/audit and by providing an explicit “Dienstplan übernehmen” action for manual overrides while the month is still schedule-open.

**Architecture:** Deadline enforcement remains derived from the Europe/Berlin date policy and does not depend on a cron job. A small idempotent state function stamps `closed_at` and writes one audit event after the deadline. Manual overrides can be reset only while schedule synchronization is still open, at which point the linked published shift is re-read and reapplied.

**Tech Stack:** TypeScript Netlify Functions, `@netlify/database`, PostgreSQL, Node tests.

## Global Constraints

- The 11th at 00:00 Europe/Berlin is the hard business boundary whether or not `closed_at` has already been written.
- `closed_at` is metadata/audit evidence, not the source of permission to sync.
- Closing a month must never reconstruct or recalculate its rows from historical schedule data.
- Reset-to-schedule is permitted only before the correction deadline and only for a row linked to an existing published schedule shift.
- After the correction deadline, a manual correction remains manual; schedule data cannot replace it.

---

### Task 1: Idempotently record month closure

**Files:**
- Modify: `netlify/functions/_shared/timesheet-repository.mts`
- Create: `scripts/timesheet-close-state-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `ensureTimesheetMonthState(monthKey: string, actorId: string, now: Date)` upserts month metadata and, after the deadline, sets `closed_at` once and writes exactly one `month-closed` audit event.

- [ ] **Step 1: Write failing tests**

Use a repository stub to prove:

```js
assert.equal(decideMonthState('2026-08', new Date('2026-09-10T21:59:59Z')), 'open')
assert.equal(decideMonthState('2026-08', new Date('2026-09-10T22:00:00Z')), 'closed')
```

Also prove two calls after closure result in one logical close event, not two.

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types scripts/timesheet-close-state-test.mjs`
Expected: FAIL because close-state functions do not exist.

- [ ] **Step 3: Implement idempotent close metadata**

Use a transaction:

```sql
UPDATE timesheet_months
   SET closed_at = COALESCE(closed_at, $2::timestamptz), updated_at = $2::timestamptz
 WHERE month_key = $1
 RETURNING closed_at;
```

Write `timesheet_audit_log.action = 'month-closed'` only when the row changed from `closed_at IS NULL` to a timestamp. Do not touch `timesheet_entries` in this operation.

- [ ] **Step 4: Call state recording from timesheet GET/sync entry points**

Every requested month may call `ensureTimesheetMonthState`; schedule sync still decides openness through `isTimesheetScheduleSyncOpen`, never through `closed_at` alone.

- [ ] **Step 5: Run test and commit**

```bash
node --experimental-strip-types scripts/timesheet-close-state-test.mjs
git add netlify/functions/_shared/timesheet-repository.mts scripts/timesheet-close-state-test.mjs package.json
git commit -m "feat: audit timesheet month closure"
```

---

### Task 2: Add explicit reset-to-schedule for manual overrides

**Files:**
- Modify: `netlify/functions/timesheets.mts`
- Modify: `netlify/functions/_shared/timesheet-schedule-sync.mts`
- Create: `scripts/timesheet-reset-to-schedule-test.mjs`
- Modify: `frontend/src/TimesheetPage.jsx`
- Modify: `package.json`

**Interfaces:**
- `POST /api/timesheets` action `reset-to-schedule`, body `{ entryId, reason }`.
- `resetTimesheetEntryToSchedule(entryId, actorId, actorRole, reason, now)` returns the restored row.

- [ ] **Step 1: Write failing policy tests**

Test:

```js
assert.equal(canResetToSchedule({ monthOpen: true, scheduleShiftId: 's1' }), true)
assert.equal(canResetToSchedule({ monthOpen: false, scheduleShiftId: 's1' }), false)
assert.equal(canResetToSchedule({ monthOpen: true, scheduleShiftId: null }), false)
```

- [ ] **Step 2: Run and confirm RED**

Run: `node --experimental-strip-types scripts/timesheet-reset-to-schedule-test.mjs`
Expected: FAIL because reset policy/function does not exist.

- [ ] **Step 3: Implement reset transaction**

1. Read the timesheet row and linked schedule shift.
2. Require the month to still be schedule-open.
3. Require linked shift status `published`.
4. Save current row as audit `before_data`.
5. Re-map the current published shift into the row.
6. Set `manual_override=false`, `source='schedule'`.
7. Write audit action `manual-reset-to-schedule` with reason.

- [ ] **Step 4: Add UI action only for eligible rows**

Show `Dienstplan übernehmen` only when `manualOverride === true`, `scheduleShiftId` exists, and API month metadata says `scheduleSyncOpen === true`. Keep manual edits available regardless of month status.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types scripts/timesheet-reset-to-schedule-test.mjs
node scripts/timesheet-independent-ui-source-test.mjs
git add netlify/functions/timesheets.mts netlify/functions/_shared/timesheet-schedule-sync.mts frontend/src/TimesheetPage.jsx scripts/timesheet-reset-to-schedule-test.mjs package.json
git commit -m "feat: allow explicit timesheet reset to schedule"
```

---

### Task 3: Add these checks to the final verification gate

- [ ] **Step 1: Ensure `verify:unified` runs both new tests**

`timesheet-close-state-test.mjs` and `timesheet-reset-to-schedule-test.mjs` must execute before the full portal E2E suite.

- [ ] **Step 2: Run full verification together with the monthly-timesheet plan**

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: all exit 0 before merge or production release.
