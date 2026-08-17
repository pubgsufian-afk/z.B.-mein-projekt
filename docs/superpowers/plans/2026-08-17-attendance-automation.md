# Attendance Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give exactly one privately configured account shift-free clock-in at saved worksites, create/update its schedule automatically, and auto-close forgotten open shifts for all employees.

**Architecture:** Keep `service.record()` as the attendance write path. Add pure flex-account/worksite/deadline policy, an `attendance-flex` schedule source, system-audited attendance writes, and a one-minute Netlify scheduled worker like the existing schedule reminder worker.

**Tech Stack:** Netlify Functions, Netlify Identity/Blobs/Database, Neon attendance repository, TypeScript `.mts`, Node tests, Playwright.

## Global Constraints

- Login behavior stays unchanged.
- Never commit the production special account name/email.
- Normal employees without a published shift remain blocked.
- Flex clock-in still requires server-verified presence inside a saved worksite.
- Flex deadline is exactly check-in + 12 hours.
- Normal deadline is exactly planned end + 30 minutes.
- Stored automatic timestamps use the exact deadline, not scheduler runtime.
- Automatic writes are idempotent and system-audited.
- If paused at deadline, create `break-end` before `clock-out`; never delete pause history.
- Do not silently create overlap with a known next shift.

---

### Task 1: Pure automation policy

**Files:**
- Create: `netlify/functions/_shared/attendance-automation-policy.mts`
- Create: `scripts/attendance-automation-policy-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `isFlexClockAccount(email, configuredEmail): boolean`
- `findAllowedWorksite(worksites, location): WorkSite | null`
- `flexCheckoutDeadline(clockInAt): Date`
- `normalCheckoutDeadline(scheduledEndAt): Date`
- `autoEventId(action, userId, deadline): string`

- [ ] **Step 1: Write RED test**

```js
import assert from 'node:assert/strict'
import { autoEventId, findAllowedWorksite, flexCheckoutDeadline, isFlexClockAccount, normalCheckoutDeadline } from '../netlify/functions/_shared/attendance-automation-policy.mts'

assert.equal(isFlexClockAccount('Special@Example.Test', 'special@example.test'), true)
assert.equal(isFlexClockAccount('other@example.test', 'special@example.test'), false)
const sites = [{ id: 'site-a', name: 'Objekt A', latitude: 52.375, longitude: 9.732, radiusMeters: 100 }]
assert.equal(findAllowedWorksite(sites, { latitude: 52.3751, longitude: 9.7321, accuracyMeters: 10 })?.id, 'site-a')
assert.equal(findAllowedWorksite(sites, { latitude: 52.39, longitude: 9.75, accuracyMeters: 10 }), null)
assert.equal(flexCheckoutDeadline('2026-08-17T16:44:00Z').toISOString(), '2026-08-18T04:44:00.000Z')
assert.equal(normalCheckoutDeadline('2026-08-17T20:00:00Z').toISOString(), '2026-08-17T20:30:00.000Z')
assert.equal(autoEventId('clock-out', 'u1', '2026-08-17T20:30:00Z'), 'auto:clock-out:u1:2026-08-17T20:30:00.000Z')
```

- [ ] **Step 2: Run RED**

```bash
node --experimental-strip-types scripts/attendance-automation-policy-test.mjs
```

- [ ] **Step 3: Implement policy** using existing `distanceMetersBetween` and `classifyLocation` from `attendance-domain.mts`; choose the closest worksite whose classification is `inside`. Implement deadlines by adding 12 hours / 30 minutes in milliseconds and deterministic event ids as `auto:${action}:${userId}:${deadlineIso}`.

- [ ] **Step 4: Add the test to `verify:unified`, run it, commit**

```bash
node --experimental-strip-types scripts/attendance-automation-policy-test.mjs
git add netlify/functions/_shared/attendance-automation-policy.mts scripts/attendance-automation-policy-test.mjs package.json
git commit -m "feat: add attendance automation policy"
```

---

### Task 2: `attendance-flex` schedule source

**Files:**
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Create: `netlify/functions/_shared/attendance-auto-shift.mts`
- Create: `scripts/attendance-auto-shift-test.mjs`

**Interfaces:**
- Extend `ScheduleSource` with `'attendance-flex'` and preserve it in row mapping.
- `createFlexAutoShift({ scheduleId, userId, fullName, checkInAt, worksite, sourceRef })`
- `finishFlexAutoShift(scheduleId, employeeUserId, endAt)`
- `findScheduleShiftWithTiming(id)` returning `scheduledStartAt`/`scheduledEndAt`.

- [ ] **Step 1: Write RED test** asserting a check-in at 18:44 Berlin creates source `attendance-flex`, start `18:44`, provisional end `06:44`, and preserves the original shift date.

- [ ] **Step 2: Extend source type**

```ts
export type ScheduleSource = 'portal' | 'chatgpt' | 'legacy-blob' | 'attendance-flex'
```

- [ ] **Step 3: Add absolute timing query**

```sql
SELECT s.*,
 ((s.shift_date + s.start_time) AT TIME ZONE 'Europe/Berlin') AS scheduled_start_at,
 ((s.shift_date + s.end_time + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0' END)
   AT TIME ZONE 'Europe/Berlin') AS scheduled_end_at
FROM schedule_shifts s WHERE s.id = $1 LIMIT 1
```

- [ ] **Step 4: Build published flex shift** with server-owned identity, matched worksite, `workArea: 'Zeiterfassung'`, `pauseMinutes: 0`, `source: 'attendance-flex'`, `createdBy/updatedBy/publishedBy: 'system:attendance-flex'`, and provisional end = check-in + 12h. `finishFlexAutoShift` may update only a flex shift owned by the same employee.

- [ ] **Step 5: Run overnight regressions and commit**

```bash
node --experimental-strip-types scripts/attendance-auto-shift-test.mjs
node --experimental-strip-types scripts/overnight-shift-attendance-regression-test.mjs
git add netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/_shared/attendance-auto-shift.mts scripts/attendance-auto-shift-test.mjs
git commit -m "feat: add attendance generated schedule shifts"
```

---

### Task 3: Flex account check-in handler

**Files:**
- Modify: `netlify/functions/attendance.mts`
- Modify: `netlify/functions/_shared/portal-role.mts` only if needed for the production actor helper.
- Create: `scripts/attendance-flex-clock-test.mjs`

**Interfaces:**
- Private config: `ATTENDANCE_FLEX_ACCOUNT_EMAIL`.
- Browser never sends or selects the exception account.

- [ ] **Step 1: Write RED cases** using only `.example.test` identities:
  - normal + no shift => `NO_PUBLISHED_SHIFT`
  - flex + no location => rejected
  - flex + outside saved worksites => rejected
  - flex + inside saved worksite => one flex schedule id bound

- [ ] **Step 2: Add server-owned `fullName`** to the attendance actor from access/Identity metadata; never trust a browser-provided employee name.

- [ ] **Step 3: Load `portal-schedule-v2` saved `objects/` server-side** with strong consistency and pass them to `findAllowedWorksite()`.

- [ ] **Step 4: Allow flex idle state without a schedule**

```ts
const flex = isFlexClockAccount(actor.email, Netlify.env.get('ATTENDANCE_FLEX_ACCOUNT_EMAIL') || '')
const visiblePhase = flex && !schedule && ['idle', 'completed'].includes(String(state.phase))
  ? 'idle'
  : displayAttendancePhase(state.phase, schedule, now)
```

Return `clocking: { allowed: true, code: 'FLEX_ACCOUNT' }` only for that account when no shift exists.

- [ ] **Step 5: Flex `clock-in` flow**
  1. If a schedule exists, use the existing path unchanged.
  2. If no schedule, require the private flex account.
  3. Require device coordinates.
  4. Match the closest saved allowed worksite.
  5. Create deterministic id `attendance-flex:${actor.userId}:${normalized.clientEventId}`.
  6. Create the provisional published auto shift.
  7. Call existing `service.record()` with that schedule id/object id so location is validated again by the existing attendance service.
  8. If the attendance write fails, compensate a newly created orphan auto shift.

- [ ] **Step 6: Manual flex `clock-out`** updates only that `attendance-flex` shift to the accepted server checkout time.

- [ ] **Step 7: Run and commit**

```bash
node --experimental-strip-types scripts/attendance-flex-clock-test.mjs
node scripts/attendance-handler-test.mjs
node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs
git add netlify/functions/attendance.mts netlify/functions/_shared/portal-role.mts scripts/attendance-flex-clock-test.mjs
git commit -m "feat: allow one configured flex clock account"
```

---

### Task 4: System actor and open sessions

**Files:**
- Modify: `netlify/functions/_shared/attendance-service.mts`
- Modify: `netlify/functions/_shared/neon-attendance.mts`
- Create: `scripts/attendance-system-actor-test.mjs`

**Interfaces:**
- Internal service role `system` is allowed only for `record()`; portal role resolution never returns it.
- Actor includes target `userId` plus audit `actorId`.
- Repository adds `listOpenSessions()`.

- [ ] **Step 1: RED test** with:

```js
const actor = { userId: 'employee-1', actorId: 'system:auto-checkout', email: 'system@habun.invalid', role: 'system' }
```

Assert event ownership stays `employee-1` while `commitClockEvent.actorId` is `system:auto-checkout`; system still cannot use management history/live.

- [ ] **Step 2: Separate audit identity** in `requireActor()`:

```ts
return { userId, actorId: String(actor?.actorId || userId).trim(), email, role }
```

Pass `actorId` to repository. In SQL, keep locks/idempotency/event `user_id` on target user but write `attendance_audit_log.actor_id` from `record.actorId || record.userId`.

- [ ] **Step 3: Add `listOpenSessions()`**: query latest event per user, keep only latest actions `clock-in`, `break-start`, `break-end`, and lateral-query the most recent preceding clock-in. Return `{ userId, phase, clockInAt, latestAt, scheduleId, objectId }`, mapping `break-start` to `paused` and the other two to `working`.

- [ ] **Step 4: Run and commit**

```bash
node --experimental-strip-types scripts/attendance-system-actor-test.mjs
node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs
git add netlify/functions/_shared/attendance-service.mts netlify/functions/_shared/neon-attendance.mts scripts/attendance-system-actor-test.mjs
git commit -m "feat: support audited system attendance events"
```

---

### Task 5: One-minute auto-checkout worker

**Files:**
- Create: `netlify/functions/attendance-auto-checkout.mts`
- Create: `scripts/attendance-auto-checkout-worker-test.mjs`
- Modify: `package.json`

**Interfaces:**
- `export const config: Config = { schedule: '* * * * *' }` like `schedule-start-reminders.mts`.

- [ ] **Step 1: RED source test** asserting worker uses `listOpenSessions`, both deadline helpers, `system:auto-checkout`, deterministic `autoEventId`, and one-minute schedule.

- [ ] **Step 2: Implement worker**

```ts
const sessions = await repository.listOpenSessions()
for (const session of sessions) {
  if (!session.scheduleId) continue
  const timing = await findScheduleShiftWithTiming(session.scheduleId)
  if (!timing) continue
  const deadline = timing.shift.source === 'attendance-flex'
    ? flexCheckoutDeadline(session.clockInAt)
    : normalCheckoutDeadline(timing.scheduledEndAt)
  if (Date.now() < deadline.getTime()) continue
  // conflict check, break-end if paused, then clock-out
}
```

Use base `attendance-service.mts`, not the daily wrapper.

- [ ] **Step 3: Conflict rule**: if a known following published shift starts before the proposed automatic deadline, do not alter the attendance time. Write schedule audit action `auto-checkout-conflict` with user/shift/deadline for management visibility.

- [ ] **Step 4: Close paused session safely** with deterministic `break-end` at the exact deadline, then deterministic `clock-out` at the same deadline.

```ts
const systemActor = { userId: session.userId, actorId: 'system:auto-checkout', email: 'system@habun.invalid', role: 'system' }
await service.record(systemActor, {
  action: 'clock-out',
  clientEventId: autoEventId('clock-out', session.userId, deadline),
  clientOccurredAt: deadline.toISOString(),
  scheduleId: session.scheduleId,
  objectId: session.objectId,
  offlineCaptured: false,
  location: null,
})
```

If source is `attendance-flex`, finish its schedule at the identical deadline.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types scripts/attendance-auto-checkout-worker-test.mjs
node scripts/push-auto-test-source-test.mjs
git add netlify/functions/attendance-auto-checkout.mts scripts/attendance-auto-checkout-worker-test.mjs package.json
git commit -m "feat: auto checkout forgotten attendance shifts"
```

---

### Task 6: Employee UI regression and private production config

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Modify: `frontend/src/App.jsx` only if `blocked` currently exposes an enabled start button.
- Netlify private environment: `ATTENDANCE_FLEX_ACCOUNT_EMAIL`.

- [ ] **Step 1: E2E flex state** mock `{ phase:'idle', schedule:null, clocking:{ allowed:true, code:'FLEX_ACCOUNT' } }` for a fictional employee and assert `Arbeit beginnen` is visible.

- [ ] **Step 2: E2E normal blocked state** mock `{ phase:'blocked', schedule:null, clocking:{ allowed:false, code:'NO_PUBLISHED_SHIFT' } }` and assert no enabled start button exists.

- [ ] **Step 3: Configure production privately**: set `ATTENDANCE_FLEX_ACCOUNT_EMAIL` in Netlify to the approved account. Do not commit or print the value.

- [ ] **Step 4: Search the branch** for the production identity and confirm this feature introduced no public occurrence.

- [ ] **Step 5: Full verification**

```bash
npm run verify
npm run build
npm run test:e2e
```

- [ ] **Step 6: Production smoke test** at a configured worksite: no pre-existing shift, flex account can start, exactly one published auto shift appears, manual checkout updates end. Use synthetic tests for 12-hour/+30-minute expiry instead of leaving a real worker open for hours.

---

## Acceptance Criteria

- Exactly one privately configured account can clock in without a shift.
- It still must be inside a saved worksite.
- Its schedule appears immediately with server-owned name/worksite/start.
- Manual checkout updates the generated schedule.
- Flex forgotten checkout closes at check-in +12h.
- Normal forgotten checkout closes at planned end +30m.
- Overnight/DST timing is absolute and correct.
- Paused sessions close through normal transition events.
- Scheduler reruns cannot duplicate events.
- Automatic audit actor is `system:auto-checkout`.
- Normal no-shift employees remain blocked.
- Authentication is unchanged.
