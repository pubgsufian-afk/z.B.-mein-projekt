# Full Admin Schedule & Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the encrypted portal-admin relay complete, efficient schedule and timesheet/attendance administration, including bulk corrections, manual time creation, targeted historical inspection, and scoped guest-to-registered identity rebinds.

**Architecture:** Build on the typed router from `2026-08-24-full-admin-relay-foundation.md`. Extract attendance mutation business rules into a reusable internal service so browser endpoints and relay use the same validation/audit/legal-hold rules. Add targeted schedule repository operations and scoped identity rebinds. New high-level actions are designed around one employee/range and bulk arrays to avoid per-day calls.

**Tech Stack:** TypeScript/Netlify Functions, Netlify Database/Postgres, Netlify Blobs, Node.js 22, existing schedule/attendance helpers, Node assertion tests and existing Playwright E2E regression tests.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- Complete Foundation Plan first.
- No direct schedule/attendance SQL from ChatGPT or the OIDC trigger; SQL remains inside typed repository/service modules.
- Every attendance write preserves legal-hold, audit, retention, overlap, and pause-boundary protections.
- Registered portal user IDs are canonical; ambiguous name matches are rejected.
- User-facing requests may span arbitrary practical ranges. Server reads are targeted by employee/date; client-side planning splits only when response/batch limits require it.
- No per-day loop when one range query can return the data.
- Bulk changes omit no-op rows.
- Cross-domain employee rebind must report consistent schedule, legacy `timesheet_entries`, attendance events, and attendance adjustments results.
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

- [ ] **Step 1: Write failing service contract tests**

Test validation-independent dependency injection so the service can be exercised without production DB credentials.

```js
import assert from 'node:assert/strict'
import {
  createAttendanceAdminService,
} from '../netlify/functions/_shared/attendance-admin-service.mts'

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

Also add source assertions that browser endpoints import `attendance-admin-service.mts` and no longer each contain their own large SQL mutation blocks.

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types scripts/attendance-admin-service-test.mjs
```

Expected: missing module/export.

- [ ] **Step 3: Implement actor and service contracts**

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

Move the existing proven SQL/validation from `attendance-time-create.mts` and `attendance-time-edit.mts` into default repository functions inside this shared service. Preserve:

- `pg_advisory_xact_lock` overlap protection for create.
- future-time validation.
- pause <= gross time.
- existing break events remaining within edited boundaries.
- exact-event legal hold checks.
- `attendance_adjustments` writes.
- `attendance_audit_log` entries.
- current 24-month retention fields.

For deletes, reuse the exact legal-hold/audit semantics currently in `attendance-assistant.mts` instead of maintaining a second implementation.

- [ ] **Step 4: Convert the browser endpoints into thin adapters**

`attendance-time-create.mts`:

```ts
const current = await currentPortalActor()
if (!current || !DIRECT_TIME_CREATE_ROLES.has(current.role)) return ...
try { verifyRequestOrigin(request) } catch { ... }
const result = await attendanceAdminService().createSession(body, {
  userId: current.userId,
  email: current.email,
  role: current.role as AttendanceAdminActor['role'],
})
return json(result, 201)
```

`attendance-time-edit.mts` follows the same pattern.

`attendance-assistant.mts` calls the same service for update/delete with the stable relay actor:

```ts
const RELAY_ACTOR = {
  userId: 'portal-admin-relay',
  email: 'portal-admin-relay@internal.invalid',
  role: 'owner' as const,
}
```

- [ ] **Step 5: Run existing + new attendance tests**

```bash
node --experimental-strip-types scripts/attendance-admin-service-test.mjs
node scripts/timesheet-create-source-test.mjs
node scripts/admin-time-editing-test.mjs
node scripts/attendance-assistant-source-test.mjs
node --experimental-strip-types scripts/attendance-assistant-core-test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/attendance-admin-service.mts netlify/functions/attendance-time-create.mts netlify/functions/attendance-time-edit.mts netlify/functions/attendance-assistant.mts scripts/attendance-admin-service-test.mjs scripts/timesheet-create-source-test.mjs scripts/admin-time-editing-test.mjs scripts/attendance-assistant-source-test.mjs
git commit -m "refactor: share attendance admin business rules"
```

---

## Task 2: Add targeted combined employee-history inspection

**Files:**
- Create: `netlify/functions/_shared/portal-admin-history.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Modify: `netlify/functions/_shared/portal-admin-schedule.mts`
- Modify: `netlify/functions/_shared/portal-admin-attendance.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-history-test.mjs`

- [ ] **Step 1: Write failing query-builder tests**

The combined inspection input must support user ID and/or exact normalized name plus range and selected domains.

```js
import assert from 'node:assert/strict'
import { normalizeHistoryInspection } from '../netlify/functions/_shared/portal-admin-history.mts'

assert.deepEqual(normalizeHistoryInspection({
  employeeUserId: 'u1',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
}), {
  employeeUserId: 'u1', employeeName: '', from: '2026-08-01', to: '2026-08-24', domains: ['schedule', 'attendance'],
})
assert.throws(() => normalizeHistoryInspection({ from: '2026-08-01', to: '2026-08-24' }), /Mitarbeiter/)
```

- [ ] **Step 2: Add pure targeted repository reads**

Extend `listScheduleShifts` only where needed; do not fetch full directory history. Add:

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

Use the confirmed schema column `timesheet_entries.work_date`.

For attendance inspection, add a read helper in `attendance-admin-service.mts` or `portal-admin-history.mts` that filters `attendance_events.event_date BETWEEN from/to` and exact `user_id` where known, joins latest pause adjustment, and returns only fields required for correction.

- [ ] **Step 3: Resolve the employee once**

`portal-admin-history.mts` first obtains the canonical registered user ID using the existing directory merge logic. If the user supplies an old/provisional identity plus target registered identity, return both identities explicitly. If a name maps to 0 or >1 active registered accounts, return `not_found`/`conflict`; never guess.

- [ ] **Step 4: Add `portal.inspect-employee-history`**

Register:

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

The result contains one compact object:

```ts
{
  employee: { userId, fullName },
  provisionalIdentities: [{ userId, fullName }],
  schedule: [...],
  legacyTimesheet: [...],
  attendance: [...],
  counts: { schedule, legacyTimesheet, attendance },
  truncated: false,
}
```

Do not include email unless the requested operation actually needs it.

- [ ] **Step 5: Add a hard encrypted-result size guard**

If the projected result would exceed the existing 400 KB encrypted payload limit, return a `conflict` item with code `RANGE_RESULT_TOO_LARGE` and counts/date bounds, not a silently truncated row set. The caller then splits the range into the minimum number of chunks.

- [ ] **Step 6: Run tests**

```bash
node --experimental-strip-types scripts/portal-admin-history-test.mjs
node scripts/schedule-provisional-reconciliation-source-test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/portal-admin-history.mts netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/_shared/portal-admin-schedule.mts netlify/functions/_shared/portal-admin-attendance.mts ops/portal-admin-capabilities.json scripts/portal-admin-history-test.mjs
git commit -m "feat: inspect employee history through one targeted relay read"
```

---

## Task 3: Add bulk schedule updates

**Files:**
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `netlify/functions/_shared/portal-admin-schedule.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-bulk-schedule-test.mjs`

- [ ] **Step 1: Write failing bulk schedule tests**

Test 1–100 updates, preserved order, no-op detection, duplicate/overlap protection, and partial explicit results.

```js
const input = {
  updates: [
    { itemId: 's1', shiftId: 'shift-1', changes: { pauseMinutes: 30 } },
    { itemId: 's2', shiftId: 'shift-2', changes: { start: '08:00', end: '16:00' } },
  ],
}
```

Expected per item status is one of `success`, `not_found`, `conflict`, `rejected`; unchanged values return `success` with `{ changed: false }` and must not rewrite the row/audit log.

- [ ] **Step 2: Implement `bulk-update-shifts` in the schedule assistant**

Reuse `updateAssistantShift` for business validation, but refactor its core into an internal function returning data rather than Response so the bulk loop does not HTTP-call itself.

```ts
for (const update of updates) {
  const before = await findScheduleShift(update.shiftId)
  if (!before) { results.push(...); continue }
  if (shiftChangesAreNoop(before, update.changes)) {
    results.push({ itemId: update.itemId, status: 'success', changed: false, shiftId: before.id })
    continue
  }
  results.push(await updateAssistantShiftRecord(update.shiftId, update.changes, employees, requestId))
}
```

Keep `MAX_BATCH = 100`.

- [ ] **Step 3: Register and route the action**

Add `schedule.bulk-update-shifts` to capability registry. The adapter maps relay input `{ updates }` to assistant action `bulk-update-shifts`.

- [ ] **Step 4: Run focused tests**

```bash
node scripts/portal-admin-bulk-schedule-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/schedule-assistant-source-test.mjs
```

- [ ] **Step 5: Commit**

```bash
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

- [ ] **Step 1: Write failing batch tests**

Cover:

- `bulk-update-attendance-sessions` with 1–100 sessions.
- `create-attendance-session` using the shared service.
- legal-hold rejection on one item without falsely marking the whole command success.
- no-op update when clock times/pause already equal effective values.

- [ ] **Step 2: Implement assistant actions**

```ts
if (action === 'bulk-update-attendance-sessions') {
  const updates = Array.isArray(body.updates) ? body.updates.slice(0, 100) : []
  const results = []
  for (const update of updates) {
    results.push(await updateAttendanceItem(update, RELAY_ACTOR))
  }
  return json({ results })
}

if (action === 'create-attendance-session') {
  const result = await attendanceAdminService().createSession(body.input, RELAY_ACTOR)
  return json({ result }, 201)
}
```

Do not relax the service protections for relay use.

- [ ] **Step 3: Register capabilities**

Add:

- `attendance.bulk-update-sessions` -> relay-supported.
- `attendance.create-session` -> relay-supported.

- [ ] **Step 4: Run focused tests**

```bash
node scripts/portal-admin-bulk-attendance-test.mjs
node scripts/attendance-assistant-source-test.mjs
node scripts/timesheet-create-source-test.mjs
node scripts/admin-time-editing-test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/attendance-assistant.mts netlify/functions/_shared/portal-admin-attendance.mts ops/portal-admin-capabilities.json scripts/portal-admin-bulk-attendance-test.mjs
git commit -m "feat: bulk manage attendance through portal relay"
```

---

## Task 5: Add scoped employee-history rebind across schedule, legacy timesheet, and attendance

**Files:**
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Modify: `netlify/functions/_shared/attendance-admin-service.mts`
- Create: `netlify/functions/_shared/employee-history-rebind.mts`
- Modify: `netlify/functions/_shared/portal-admin-history.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-history-rebind-test.mjs`

- [ ] **Step 1: Write failing scoped-rebind tests**

Use a fake repository to prove rows outside the requested range are untouched and requested domains are honored.

```js
const result = await rebindEmployeeHistory({
  sourceUserId: 'guest:abc',
  targetUserId: 'registered-kwame',
  targetFullName: 'Kwame Akakpo',
  from: '2026-08-01',
  to: '2026-08-24',
  domains: ['schedule', 'attendance'],
  reason: 'Registriertes Konto zuordnen',
}, actor, repository)

assert.deepEqual(result.range, { from: '2026-08-01', to: '2026-08-24' })
assert.equal(result.schedule.shiftCount >= 0, true)
assert.equal(result.attendance.eventCount >= 0, true)
```

- [ ] **Step 2: Add a scoped schedule/legacy-timesheet repository transaction**

Create a new function instead of changing the semantics of legacy `rebindProvisionalEmployeeIdentity` immediately:

```ts
export async function rebindScheduleEmployeeHistory(input: {
  sourceUserId: string
  targetUserId: string
  targetFullName: string
  from: string
  to: string
  actorId: string
})
```

Schedule update:

```sql
UPDATE schedule_shifts
   SET employee_user_id = $2,
       employee_name = $3,
       updated_at = now(),
       updated_by = $6
 WHERE employee_user_id = $1
   AND shift_date BETWEEN $4::date AND $5::date
```

Legacy timesheet update uses the confirmed `work_date` schema:

```sql
UPDATE timesheet_entries
   SET employee_user_id = $2,
       employee_name = $3,
       updated_at = now(),
       updated_by = $6
 WHERE employee_user_id = $1
   AND work_date BETWEEN $4::date AND $5::date
```

Before update, detect exact target schedule conflicts in the same range. Write audit counts and range, never employee private data beyond IDs already required for the audit model.

- [ ] **Step 3: Add scoped attendance rebind**

In one transaction/atomic SQL unit where supported:

1. Find source attendance event IDs where `user_id = sourceUserId AND event_date BETWEEN from AND to`.
2. Reject if any exact event ID has an active `attendance_legal_holds` row.
3. Update `attendance_events.user_id` for those event IDs.
4. Update `attendance_adjustments.user_id` for adjustments tied to those event IDs.
5. Add an `attendance_audit_log` record with action `admin-employee-rebind`, range, source/target IDs and affected counts.

Do not modify timestamps/actions merely for rebind.

- [ ] **Step 4: Coordinate domains in `employee-history-rebind.mts`**

Allowed domains are exactly `schedule`, `attendance`, or both. Schedule service itself includes legacy `timesheet_entries` because those rows mirror schedule/manual timesheets in the same DB.

If schedule rebind succeeds and attendance fails, return `conflict` with per-domain details and immediately run targeted verification. Do not claim full success. Where both use the same database connection abstraction during implementation, prefer a single shared transaction; if they remain separate pools/stores, use explicit coordinated workflow with before/after counts as specified.

- [ ] **Step 5: Register `portal.rebind-employee-history`**

Input:

```ts
{
  sourceUserId: string,
  targetUserId: string,
  targetFullName: string,
  from: string,
  to: string,
  domains: Array<'schedule' | 'attendance'>,
  reason: string,
}
```

Require source and target IDs to differ. Target cannot be `guest:`. When source is a provisional guest, validate via `isProvisionalEmployeeUserId`; for explicit stale registered-ID corrections, require `reason` and a uniquely resolved target.

- [ ] **Step 6: Run tests**

```bash
node --experimental-strip-types scripts/portal-admin-history-rebind-test.mjs
node scripts/schedule-provisional-reconciliation-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/_shared/attendance-admin-service.mts netlify/functions/_shared/employee-history-rebind.mts netlify/functions/_shared/portal-admin-history.mts ops/portal-admin-capabilities.json scripts/portal-admin-history-rebind-test.mjs
git commit -m "feat: rebind employee history by scoped date range"
```

---

## Task 6: Add minimum-chunk range planning and no-op mutation planning

**Files:**
- Create: `scripts/portal-admin-client-planner.mjs`
- Create: `scripts/portal-admin-client-planner-test.mjs`

- [ ] **Step 1: Write failing planner tests**

The client-side helper is used by future relay invocation code, not the portal runtime.

```js
import assert from 'node:assert/strict'
import { minimalDateChunks, changedRowsOnly } from './portal-admin-client-planner.mjs'

assert.deepEqual(minimalDateChunks('2026-08-01', '2026-08-24', 62), [
  { from: '2026-08-01', to: '2026-08-24' },
])
assert.equal(minimalDateChunks('2026-01-01', '2026-08-24', 62).length, 4)
assert.deepEqual(changedRowsOnly([
  { id: 'a', before: { pauseMinutes: 30 }, after: { pauseMinutes: 30 } },
  { id: 'b', before: { pauseMinutes: 0 }, after: { pauseMinutes: 30 } },
]).map((row) => row.id), ['b'])
```

- [ ] **Step 2: Implement deterministic minimal chunking**

Use calendar-day arithmetic in UTC noon/date-only form. Generate the fewest contiguous chunks for the supplied maximum inclusive days; never split a range that already fits.

- [ ] **Step 3: Implement no-op diffing for JSON-safe projected fields**

Compare only explicit `before`/`after` projected fields, not metadata timestamps. Keep deterministic key ordering.

- [ ] **Step 4: Run tests**

```bash
node scripts/portal-admin-client-planner-test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add scripts/portal-admin-client-planner.mjs scripts/portal-admin-client-planner-test.mjs
git commit -m "feat: plan minimal portal admin range batches"
```

---

## Task 7: End-to-end Kwame-style historical correction verification

**Files:**
- Create: `scripts/portal-admin-schedule-attendance-integration-test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Build an integration fixture that represents a newly registered employee**

Fixture includes:

- registered `Kwame Akakpo` identity.
- old provisional `Kwame` guest identity.
- schedule rows before, inside, and after `2026-08-01..2026-08-24`.
- matching `timesheet_entries.work_date` rows.
- attendance events/adjustments inside range.
- one unrelated employee.

Test flow must be exactly:

1. one `inspect-employee-history`.
2. one `rebind-employee-history`.
3. one verification `inspect-employee-history`.

Assert the in-range rows use the registered user ID and name, out-of-range rows remain unchanged, and unrelated rows remain untouched.

- [ ] **Step 2: Assert the cost contract in the test**

```js
assert.deepEqual(calls.map((call) => call.action), [
  'inspect-employee-history',
  'rebind-employee-history',
  'inspect-employee-history',
])
```

This makes the sparse-call design executable, not merely documentation.

- [ ] **Step 3: Add focused verification script**

```json
"verify:portal-admin-schedule-attendance": "node --experimental-strip-types scripts/attendance-admin-service-test.mjs && node --experimental-strip-types scripts/portal-admin-history-test.mjs && node scripts/portal-admin-bulk-schedule-test.mjs && node scripts/portal-admin-bulk-attendance-test.mjs && node --experimental-strip-types scripts/portal-admin-history-rebind-test.mjs && node scripts/portal-admin-client-planner-test.mjs && node --experimental-strip-types scripts/portal-admin-schedule-attendance-integration-test.mjs"
```

- [ ] **Step 4: Run focused tests**

```bash
npm run verify:portal-admin-schedule-attendance
```

Expected: exit 0.

- [ ] **Step 5: Run relevant existing regressions**

```bash
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/schedule-provisional-reconciliation-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
node scripts/admin-time-editing-test.mjs
node scripts/timesheet-create-source-test.mjs
node scripts/timesheet-utils-test.mjs
node scripts/timesheet-integration-test.mjs
node scripts/timesheet-report-source-test.mjs
```

- [ ] **Step 6: Run full verification**

```bash
npm run verify
```

- [ ] **Step 7: Commit**

```bash
git add scripts/portal-admin-schedule-attendance-integration-test.mjs package.json
git commit -m "test: verify full schedule attendance admin flow"
```

## Schedule & Attendance Done Criteria

- A single combined read can inspect one employee/range across schedule, legacy timesheet, and attendance.
- Schedule shifts can be corrected in one bounded bulk command.
- Attendance sessions can be created or corrected in one bounded bulk command using the same rules as the portal UI.
- Pauses can be changed through the relay without bypassing audit/legal-hold rules.
- Explicit scoped rebind can move old guest/stale history to one registered identity for only the requested range/domains.
- The Kwame-style use case is proven as `1 read -> 1 rebind -> 1 verification`, with no per-day loop.