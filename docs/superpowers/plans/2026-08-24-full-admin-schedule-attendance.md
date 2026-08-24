# Full Admin Schedule & Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the encrypted portal-admin relay complete, efficient schedule and timesheet/attendance administration, including bulk corrections, manual time creation, targeted historical inspection, and scoped guest-to-registered identity rebinds.

**Architecture:** Build on the typed router from `2026-08-24-full-admin-relay-foundation.md`. Extract attendance mutation business rules into a reusable service shared by browser endpoints and relay. Add targeted schedule/timesheet reads, bounded bulk mutations, scoped rebind transactions, and a deterministic client planner so large requests use the fewest possible calls.

**Tech Stack:** TypeScript/Netlify Functions, Netlify Database/Postgres, Netlify Blobs, Node.js 22, existing schedule/attendance helpers, Node assertion tests, Playwright E2E regressions.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- Complete the Foundation Plan first.
- SQL remains inside typed repository/service modules; the OIDC trigger never writes data directly.
- Attendance writes preserve legal holds, audit, retention, overlap, future-time, and pause-boundary protections.
- Registered portal user IDs are canonical; ambiguous matches are rejected.
- User-facing requests may span arbitrary practical ranges; splitting occurs only when response/batch limits require it.
- No per-day loop when one employee/date-range query can return the required data.
- Bulk mutation code omits no-op rows.
- A cross-domain rebind reports schedule, legacy `timesheet_entries`, attendance events, and attendance adjustments separately.
- Normal target remains one combined inspection, one batch/rebind, one combined verification.

---

## Task 1: Extract a reusable attendance admin service

**Files:**
- Create: `netlify/functions/_shared/attendance-admin-service.mts`
- Modify: `netlify/functions/attendance-time-create.mts`
- Modify: `netlify/functions/attendance-time-edit.mts`
- Modify: `netlify/functions/attendance-assistant.mts`
- Create: `scripts/attendance-admin-service-test.mjs`
- Modify: `scripts/timesheet-create-source-test.mjs`
- Modify: `scripts/admin-time-editing-test.mjs`
- Modify: `scripts/attendance-assistant-source-test.mjs`

- [ ] **Step 1: Write failing dependency-injected service tests**

```js
import assert from 'node:assert/strict'
import { createAttendanceAdminService } from '../netlify/functions/_shared/attendance-admin-service.mts'

const calls = []
const service = createAttendanceAdminService({
  async createSession(input, actor) { calls.push(['create', input, actor]); return { saved: true, clockInEventId: 'in1', clockOutEventId: 'out1' } },
  async updateSession(input, actor) { calls.push(['update', input, actor]); return { saved: true } },
  async deleteEvents(input, actor) { calls.push(['delete', input, actor]); return { deletedIds: input.eventIds } },
})
const actor = { userId: 'portal-admin-relay', email: 'portal-admin-relay@internal.invalid', role: 'owner' }
assert.equal((await service.createSession({ userId: 'u1', clockInAt: '2026-08-20T06:00:00Z', clockOutAt: '2026-08-20T14:00:00Z', pauseMinutes: 30 }, actor)).saved, true)
assert.equal((await service.updateSession({ clockInEventId: 'i', clockOutEventId: 'o', clockInAt: '2026-08-20T06:00:00Z', clockOutAt: '2026-08-20T14:00:00Z', pauseMinutes: 30, reason: 'Korrektur' }, actor)).saved, true)
assert.deepEqual((await service.deleteEvents({ eventIds: ['e1'], reason: 'Fehleintrag' }, actor)).deletedIds, ['e1'])
assert.equal(calls.length, 3)
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types scripts/attendance-admin-service-test.mjs
```

- [ ] **Step 3: Implement service contracts**

```ts
export type AttendanceAdminActor = {
  userId: string
  email: string
  role: 'owner' | 'admin' | 'manager'
}

export type AttendanceSessionCreateInput = {
  userId: string
  clockInAt: string
  clockOutAt: string
  pauseMinutes: number
  scheduleId?: string | null
  objectId?: string | null
  reason?: string
}

export type AttendanceSessionUpdateInput = {
  clockInEventId: string
  clockOutEventId: string
  clockInAt: string
  clockOutAt: string
  pauseMinutes: number
  reason: string
}
```

Move the existing proven mutation logic from `attendance-time-create.mts`, `attendance-time-edit.mts`, and attendance-assistant delete handling into default service repository methods. Preserve `pg_advisory_xact_lock`, future-time checks, pause <= gross time, break boundary checks, legal holds, `attendance_adjustments`, `attendance_audit_log`, and current retention fields.

- [ ] **Step 4: Convert browser endpoints to thin adapters**

Use explicit HTTP responses rather than embedding service logic:

```ts
const current = await currentPortalActor()
if (!current) return json({ message: 'Nicht angemeldet.' }, 401)
if (!DIRECT_TIME_CREATE_ROLES.has(current.role)) return json({ message: 'Keine Berechtigung.' }, 403)
try {
  verifyRequestOrigin(request)
} catch {
  return json({ message: 'Ungültige Anfragequelle.' }, 403)
}
const result = await attendanceAdminService().createSession(body, {
  userId: current.userId,
  email: current.email,
  role: current.role as AttendanceAdminActor['role'],
})
return json(result, 201)
```

`attendance-time-edit.mts` follows the same pattern. `attendance-assistant.mts` uses:

```ts
const RELAY_ACTOR = {
  userId: 'portal-admin-relay',
  email: 'portal-admin-relay@internal.invalid',
  role: 'owner' as const,
}
```

- [ ] **Step 5: Run attendance regressions**

```bash
node --experimental-strip-types scripts/attendance-admin-service-test.mjs
node scripts/timesheet-create-source-test.mjs
node scripts/admin-time-editing-test.mjs
node scripts/attendance-assistant-source-test.mjs
node --experimental-strip-types scripts/attendance-assistant-core-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/attendance-admin-service.mts netlify/functions/attendance-time-create.mts netlify/functions/attendance-time-edit.mts netlify/functions/attendance-assistant.mts scripts/attendance-admin-service-test.mjs scripts/timesheet-create-source-test.mjs scripts/admin-time-editing-test.mjs scripts/attendance-assistant-source-test.mjs
git commit -m "refactor: share attendance admin business rules"
```

---

## Task 2: Add one targeted combined employee-history inspection

**Files:**
- Create: `netlify/functions/_shared/portal-admin-history.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Modify: `netlify/functions/_shared/attendance-admin-service.mts`
- Modify: `netlify/functions/_shared/portal-admin-router.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-history-test.mjs`

- [ ] **Step 1: Write failing normalization tests**

```js
import assert from 'node:assert/strict'
import { normalizeHistoryInspection } from '../netlify/functions/_shared/portal-admin-history.mts'

assert.deepEqual(normalizeHistoryInspection({
  employeeUserId: 'u1', from: '2026-08-01', to: '2026-08-24', domains: ['schedule', 'attendance'],
}), {
  employeeUserId: 'u1', employeeName: '', from: '2026-08-01', to: '2026-08-24', domains: ['schedule', 'attendance'],
})
assert.throws(() => normalizeHistoryInspection({ from: '2026-08-01', to: '2026-08-24' }), /Mitarbeiter/)
```

- [ ] **Step 2: Add targeted legacy timesheet read using the confirmed schema**

```ts
export async function listLegacyTimesheetEntries(filters: {
  from: string
  to: string
  employeeUserId?: string
}) {
  const clauses = ['work_date BETWEEN $1::date AND $2::date']
  const params: unknown[] = [filters.from, filters.to]
  if (filters.employeeUserId) {
    params.push(filters.employeeUserId)
    clauses.push(`employee_user_id = $${params.length}`)
  }
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT id, schedule_shift_id, employee_user_id, employee_name, work_date,
            start_time, end_time, pause_minutes, net_minutes, location, work_area,
            source, manual_override
       FROM timesheet_entries
      WHERE ${clauses.join(' AND ')}
      ORDER BY work_date, start_time, id`,
    params,
  )
  return result.rows
}
```

`timesheet_entries.work_date` is confirmed by migration `20260811233000_create-timesheet-monthly-snapshots`.

- [ ] **Step 3: Add targeted attendance read**

Query `attendance_events` by `event_date BETWEEN from/to` and exact `user_id` when resolved, left-join the latest `attendance_adjustments` value, and return only event/session correction fields. Do not load all employees or all history.

- [ ] **Step 4: Resolve identity once and return a typed snapshot**

Define:

```ts
export type EmployeeHistorySnapshot = {
  employee: { userId: string; fullName: string } | null
  provisionalIdentities: Array<{ userId: string; fullName: string }>
  schedule: ScheduleShift[]
  legacyTimesheet: LegacyTimesheetEntry[]
  attendance: AttendanceEventSnapshot[]
  counts: { schedule: number; legacyTimesheet: number; attendance: number }
  truncated: false
}
```

If exact name resolution gives zero matches, return `not_found`; if more than one active account matches, return `conflict`. Never guess.

- [ ] **Step 5: Register `portal.inspect-employee-history`**

```json
{
  "id": "portal.inspect-employee-history",
  "surface": "Portal Admin",
  "endpoint": "/api/schedule-oidc-trigger",
  "method": "POST",
  "action": "inspect-employee-history",
  "classification": "relay-read-only",
  "relay": { "domain": "portal", "action": "inspect-employee-history" }
}
```

Register a `portal` handler in the router for this action.

- [ ] **Step 6: Guard encrypted result size**

Calculate JSON byte length before returning detailed data. If it would exceed 400,000 bytes, return `conflict` code `RANGE_RESULT_TOO_LARGE` with counts and requested date bounds only. The client planner then creates the minimum number of chunks.

- [ ] **Step 7: Run tests and commit**

```bash
node --experimental-strip-types scripts/portal-admin-history-test.mjs
node scripts/schedule-provisional-reconciliation-source-test.mjs
git add netlify/functions/_shared/portal-admin-history.mts netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/_shared/attendance-admin-service.mts netlify/functions/_shared/portal-admin-router.mts ops/portal-admin-capabilities.json scripts/portal-admin-history-test.mjs
git commit -m "feat: inspect employee history through one targeted relay read"
```

---

## Task 3: Add bulk schedule updates

**Files:**
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `netlify/functions/_shared/portal-admin-schedule.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-bulk-schedule-test.mjs`

- [ ] **Step 1: Write failing tests for 1–100 updates, order, no-op, conflict, and not-found results**

Use inputs shaped as:

```js
const input = {
  updates: [
    { itemId: 's1', shiftId: 'shift-1', changes: { pauseMinutes: 30 } },
    { itemId: 's2', shiftId: 'shift-2', changes: { start: '08:00', end: '16:00' } },
  ],
}
```

- [ ] **Step 2: Refactor current single-shift update into a reusable record function**

The helper returns a typed result and performs the same employee/worksite/overlap/audit validation as today. For a missing row return:

```ts
results.push({ itemId: update.itemId, status: 'not_found', code: 'SHIFT_NOT_FOUND', shiftId: update.shiftId })
```

For unchanged projected values return `success` with `changed: false` and skip upsert/audit. Otherwise call the reusable update helper. Keep `MAX_BATCH = 100`.

- [ ] **Step 3: Register `schedule.bulk-update-shifts` and map it in the adapter**

- [ ] **Step 4: Run tests and commit**

```bash
node scripts/portal-admin-bulk-schedule-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/schedule-assistant-source-test.mjs
git add netlify/functions/schedule-assistant.mts netlify/functions/_shared/portal-admin-schedule.mts ops/portal-admin-capabilities.json scripts/portal-admin-bulk-schedule-test.mjs
git commit -m "feat: bulk update schedule shifts through relay"
```

---

## Task 4: Add bulk attendance session updates and manual creation

**Files:**
- Modify: `netlify/functions/attendance-assistant.mts`
- Modify: `netlify/functions/_shared/portal-admin-attendance.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-bulk-attendance-test.mjs`

- [ ] **Step 1: Write failing tests**

Cover `bulk-update-attendance-sessions` with 1–100 sessions, `create-attendance-session`, one legal-hold rejection inside a mixed batch, and no-op detection.

- [ ] **Step 2: Implement bounded assistant actions using `attendance-admin-service`**

```ts
if (action === 'bulk-update-attendance-sessions') {
  const updates = Array.isArray(body.updates) ? body.updates.slice(0, 100) : []
  const results = []
  for (const update of updates) results.push(await updateAttendanceItem(update, RELAY_ACTOR))
  return json({ results })
}

if (action === 'create-attendance-session') {
  const input = body.input && typeof body.input === 'object' ? body.input as Record<string, unknown> : {}
  const result = await attendanceAdminService().createSession(input, RELAY_ACTOR)
  return json({ result }, 201)
}
```

Do not relax service protections for relay use.

- [ ] **Step 3: Register capabilities**

Add `attendance.bulk-update-sessions` and `attendance.create-session` as `relay-supported`.

- [ ] **Step 4: Run tests and commit**

```bash
node scripts/portal-admin-bulk-attendance-test.mjs
node scripts/attendance-assistant-source-test.mjs
node scripts/timesheet-create-source-test.mjs
node scripts/admin-time-editing-test.mjs
git add netlify/functions/attendance-assistant.mts netlify/functions/_shared/portal-admin-attendance.mts ops/portal-admin-capabilities.json scripts/portal-admin-bulk-attendance-test.mjs
git commit -m "feat: bulk manage attendance through portal relay"
```

---

## Task 5: Add scoped employee-history rebind

**Files:**
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Modify: `netlify/functions/_shared/attendance-admin-service.mts`
- Create: `netlify/functions/_shared/employee-history-rebind.mts`
- Modify: `netlify/functions/_shared/portal-admin-history.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-history-rebind-test.mjs`

- [ ] **Step 1: Write failing range/domain tests**

Use a fake repository with rows before, inside, and after the range and assert only requested rows/domains change.

- [ ] **Step 2: Add scoped schedule + legacy timesheet transaction**

```sql
UPDATE schedule_shifts
   SET employee_user_id = $2, employee_name = $3, updated_at = now(), updated_by = $6
 WHERE employee_user_id = $1
   AND shift_date BETWEEN $4::date AND $5::date
```

```sql
UPDATE timesheet_entries
   SET employee_user_id = $2, employee_name = $3, updated_at = now(), updated_by = $6
 WHERE employee_user_id = $1
   AND work_date BETWEEN $4::date AND $5::date
```

Before update, detect exact target schedule conflicts in the same range. Keep the current unscoped legacy rebind function intact for backward compatibility until all callers migrate.

- [ ] **Step 3: Add scoped attendance rebind**

Within one DB transaction/unit:

1. select source event IDs with `user_id = sourceUserId` and requested `event_date` range.
2. reject when any selected event is under `attendance_legal_holds`.
3. update `attendance_events.user_id` for selected IDs.
4. update `attendance_adjustments.user_id` for adjustments tied to selected IDs.
5. insert one `attendance_audit_log` row with action `admin-employee-rebind`, range, source/target IDs, and counts.

- [ ] **Step 4: Coordinate the requested domains**

Input contract:

```ts
export type EmployeeHistoryRebindInput = {
  sourceUserId: string
  targetUserId: string
  targetFullName: string
  from: string
  to: string
  domains: Array<'schedule' | 'attendance'>
  reason: string
}
```

Target ID cannot start with `guest:` and source/target must differ. If source is not provisional, require an explicit reason and uniquely verified target. Return per-domain counts. On partial failure return `conflict` and immediately perform a targeted verification read; never state full success.

- [ ] **Step 5: Register `portal.rebind-employee-history` and run tests**

```bash
node --experimental-strip-types scripts/portal-admin-history-rebind-test.mjs
node scripts/schedule-provisional-reconciliation-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
git add netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/_shared/attendance-admin-service.mts netlify/functions/_shared/employee-history-rebind.mts netlify/functions/_shared/portal-admin-history.mts ops/portal-admin-capabilities.json scripts/portal-admin-history-rebind-test.mjs
git commit -m "feat: rebind employee history by scoped date range"
```

---

## Task 6: Add minimum-chunk and no-op client planning

**Files:**
- Create: `scripts/portal-admin-client-planner.mjs`
- Create: `scripts/portal-admin-client-planner-test.mjs`

- [ ] **Step 1: Write failing planner tests**

```js
import assert from 'node:assert/strict'
import { minimalDateChunks, changedRowsOnly } from './portal-admin-client-planner.mjs'

assert.deepEqual(minimalDateChunks('2026-08-01', '2026-08-24', 62), [{ from: '2026-08-01', to: '2026-08-24' }])
assert.equal(minimalDateChunks('2026-01-01', '2026-08-24', 62).length, 4)
assert.deepEqual(changedRowsOnly([
  { id: 'a', before: { pauseMinutes: 30 }, after: { pauseMinutes: 30 } },
  { id: 'b', before: { pauseMinutes: 0 }, after: { pauseMinutes: 30 } },
]).map((row) => row.id), ['b'])
```

- [ ] **Step 2: Implement deterministic minimal date chunking**

Use date-only UTC arithmetic; generate the fewest contiguous inclusive chunks and never split a range that already fits.

- [ ] **Step 3: Implement deterministic no-op diffing**

Compare only explicit projected `before`/`after` values, not audit/update timestamps.

- [ ] **Step 4: Run and commit**

```bash
node scripts/portal-admin-client-planner-test.mjs
git add scripts/portal-admin-client-planner.mjs scripts/portal-admin-client-planner-test.mjs
git commit -m "feat: plan minimal portal admin range batches"
```

---

## Task 7: Prove the Kwame-style correction and sparse-call contract

**Files:**
- Create: `scripts/portal-admin-schedule-attendance-integration-test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Build a deterministic integration fixture**

Fixture contains registered `Kwame Akakpo`, old provisional `Kwame`, schedule and `timesheet_entries.work_date` rows before/inside/after `2026-08-01..2026-08-24`, attendance events/adjustments in range, and an unrelated employee.

- [ ] **Step 2: Execute exactly one inspect, one rebind, one verification inspect**

```js
assert.deepEqual(calls.map((call) => call.action), [
  'inspect-employee-history',
  'rebind-employee-history',
  'inspect-employee-history',
])
```

Assert all in-range target rows use the registered ID/name after rebind; out-of-range and unrelated rows are unchanged.

- [ ] **Step 3: Add focused verification script**

```json
"verify:portal-admin-schedule-attendance": "node --experimental-strip-types scripts/attendance-admin-service-test.mjs && node --experimental-strip-types scripts/portal-admin-history-test.mjs && node scripts/portal-admin-bulk-schedule-test.mjs && node scripts/portal-admin-bulk-attendance-test.mjs && node --experimental-strip-types scripts/portal-admin-history-rebind-test.mjs && node scripts/portal-admin-client-planner-test.mjs && node --experimental-strip-types scripts/portal-admin-schedule-attendance-integration-test.mjs"
```

- [ ] **Step 4: Run focused and existing regressions**

```bash
npm run verify:portal-admin-schedule-attendance
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/schedule-provisional-reconciliation-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
node scripts/admin-time-editing-test.mjs
node scripts/timesheet-create-source-test.mjs
node scripts/timesheet-utils-test.mjs
node scripts/timesheet-integration-test.mjs
node scripts/timesheet-report-source-test.mjs
npm run verify
```

- [ ] **Step 5: Commit**

```bash
git add scripts/portal-admin-schedule-attendance-integration-test.mjs package.json
git commit -m "test: verify full schedule attendance admin flow"
```

## Schedule & Attendance Done Criteria

- One combined read inspects one employee/range across schedule, legacy timesheet, and attendance.
- Schedule shifts and attendance sessions support bounded bulk correction.
- Manual attendance creation uses the same business rules as the portal UI.
- Pauses can be corrected without bypassing audit/legal-hold protections.
- Scoped rebind updates only requested dates/domains and uses the registered canonical identity.
- The Kwame-style use case is proven as `1 read -> 1 rebind -> 1 verification`, with no per-day loop.