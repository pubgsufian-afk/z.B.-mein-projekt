# Automatic Schedule Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically notify only affected employees when published schedules are created, changed, or deleted, and remind each assigned employee five minutes before a published shift starts, with no manual notification bell.

**Architecture:** Keep the existing Web Push device registration and VAPID delivery layer, but remove arbitrary manual sending from the browser/API. Add a narrow server-side schedule notification module with fixed privacy-safe copy, invoke it after successful published schedule mutations in both the portal and schedule-assistant paths, and add a one-minute Netlify Scheduled Function that claims reminder rows atomically in Neon before sending five-minute start reminders.

**Tech Stack:** React/Vite frontend, Netlify Functions, Netlify Scheduled Functions, `@netlify/identity`, `@netlify/blobs`, `@netlify/database`/Neon Postgres, Node.js 24, existing Web Push/VAPID implementation, Node `assert` source/core tests, Playwright E2E.

## Global Constraints

- Only published schedule events may trigger schedule-change push notifications; draft-only changes must never notify.
- A new schedule publication sends exactly one notification per employee included in that publication, even if that employee has multiple shifts.
- Later published shift changes/deletions notify only affected employees.
- Reassignment from employee A to employee B notifies A and B when the old/new assignment is published-relevant.
- Five-minute reminders apply only to published shifts and are sent at most once per shift start value.
- Reminder copy: `Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.`
- New-publication copy: `Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.`
- Published-change copy: `Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.`
- Push text must not contain shift times, worksites, or other schedule details.
- The manual bell and manual free-text sender must be fully removed from the UI and the HTTP API.
- Device permission/registration and the one-time per-device activation test remain supported.
- Push failures must never roll back or repeat a successful schedule database mutation.
- Batch Relay must inherit the same behavior through `/api/schedule-assistant`; do not add a second notification call in `schedule-command-worker.mts`.
- Reminder time conversion must use `Europe/Berlin` in the database so DST is handled by Postgres.
- No new polling is added to the browser.

---

## File Structure

**Create**
- `netlify/functions/_shared/schedule-push.mts` — fixed schedule notification copy, recipient deduplication at the schedule-notification boundary, and best-effort calls into Web Push.
- `netlify/functions/_shared/schedule-reminder-core.mts` — pure reminder window/key/result-policy helpers.
- `netlify/functions/schedule-start-reminders.mts` — one-minute scheduled reminder worker.
- `netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql` — atomic reminder claim/sent state table.
- `scripts/schedule-reminder-core-test.mjs` — pure tests for reminder window/key/result policy.
- `scripts/automatic-schedule-push-source-test.mjs` — integration/source contract for all event hooks and removal of manual sending.
- `scripts/schedule-reminder-source-test.mjs` — source/migration contract for the worker and atomic claim query.

**Modify**
- `netlify/functions/_shared/push-core.mts` — replace broadcast/manual `sendPortalPush` with server-only `sendPushToUsers(userIds, message)` and export a delivery result type.
- `netlify/functions/push.mts` — remove `action: 'send'`; retain public key, message fetch, subscribe, unsubscribe, and activation test only.
- `frontend/src/push-notifications.js` — remove admin bell/modal sender while retaining registration, iOS Home Screen guidance, auth lifecycle, and activation test.
- `frontend/src/push-notifications.css` — delete bell/modal-only styles.
- `netlify/functions/_shared/schedule-neon-repository.mts` — add upcoming-published-shift query plus atomic reminder claim/complete/release functions.
- `netlify/functions/schedule-v2-neon.mts` — notify after successful portal publication/change/delete.
- `netlify/functions/schedule-assistant.mts` — notify after successful assistant/Batch Relay publication/change/delete and dedupe publication recipients per batch.
- `package.json` — add the new source/core tests to `verify:unified`.
- `tests/e2e/unified-portal.spec.mjs` — assert the old manual push control is absent for management users.

---

### Task 1: Make Web Push server-only for schedule delivery and remove the manual sender

**Files:**
- Modify: `netlify/functions/_shared/push-core.mts`
- Modify: `netlify/functions/push.mts`
- Modify: `frontend/src/push-notifications.js`
- Modify: `frontend/src/push-notifications.css`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Create/extend in Task 4: `scripts/automatic-schedule-push-source-test.mjs`

**Interfaces:**
- Consumes: existing `DeviceRecord`, `sendWake()`, `vapidConfig()`, device token registration, and `sendDeviceTestPush()`.
- Produces:
  ```ts
  export type PushDeliveryResult = {
    targeted: number
    delivered: number
    removed: number
    messageId: string
  }

  export async function sendPushToUsers(options: {
    userIds: string[]
    title: string
    body: string
    url?: string
  }): Promise<PushDeliveryResult>
  ```
- `sendPushToUsers()` must never interpret an empty `userIds` array as broadcast. Empty recipients return `{ targeted: 0, delivered: 0, removed: 0, messageId }` without contacting push endpoints.

- [ ] **Step 1: Write a failing source test for removal of manual sending**

Create the initial `scripts/automatic-schedule-push-source-test.mjs` with these assertions:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const frontend = readFileSync('frontend/src/push-notifications.js', 'utf8')
const pushApi = readFileSync('netlify/functions/push.mts', 'utf8')
const pushCore = readFileSync('netlify/functions/_shared/push-core.mts', 'utf8')

assert.doesNotMatch(frontend, /mountAdminSender/)
assert.doesNotMatch(frontend, /data-habun-push-admin/)
assert.doesNotMatch(frontend, /Benachrichtigung senden|Jetzt schicken/)
assert.doesNotMatch(pushApi, /action === ['"]send['"]/)
assert.doesNotMatch(pushApi, /sendPortalPush/)
assert.doesNotMatch(pushCore, /export async function sendPortalPush/)
assert.match(pushCore, /export async function sendPushToUsers/)
assert.match(pushCore, /userIds:\s*string\[\]/)

console.log('Automatic schedule push source contract passed')
```

- [ ] **Step 2: Run the source test and verify it fails**

Run:

```bash
node scripts/automatic-schedule-push-source-test.mjs
```

Expected: FAIL because the current frontend contains `mountAdminSender`, `/api/push` accepts `action === 'send'`, and `push-core.mts` still exports `sendPortalPush`.

- [ ] **Step 3: Replace arbitrary/manual push delivery with targeted server-only delivery**

In `netlify/functions/_shared/push-core.mts`:

1. Remove `MANAGEMENT` and `actorRole` authorization from the delivery primitive; authorization belongs at the calling feature boundary.
2. Export `PushDeliveryResult`.
3. Replace `sendPortalPush()` with this shape:

```ts
export async function sendPushToUsers(options: {
  userIds: string[]
  title: string
  body: string
  url?: string
}): Promise<PushDeliveryResult> {
  const userIds = [...new Set(options.userIds.map((value) => String(value || '').trim()).filter(Boolean))]
  const title = String(options.title || '').trim().slice(0, 80)
  const body = String(options.body || '').trim().slice(0, 300)
  const url = String(options.url || '/').trim() || '/'
  if (!title || !body) throw new TypeError('Titel und Nachricht sind erforderlich.')

  const message: PushMessage = {
    id: crypto.randomUUID(),
    title,
    body,
    url,
    createdAt: new Date().toISOString(),
  }
  if (!userIds.length) return { targeted: 0, delivered: 0, removed: 0, messageId: message.id }

  const recipients = new Set(userIds)
  const devices = (await listDevices()).filter((row) => recipients.has(row.userId))
  const config = devices.length ? await vapidConfig() : null
  let delivered = 0
  let removed = 0

  for (const device of devices) {
    const key = `devices/${device.tokenHash}`
    await store().setJSON(key, { ...device, latestMessage: message, updatedAt: new Date().toISOString() })
    try {
      const response = await sendWake(device.endpoint, config!)
      if (response.ok) delivered += 1
      else if (response.status === 404 || response.status === 410) {
        await store().delete(key)
        removed += 1
      } else {
        console.warn('Push service rejected request', response.status, device.endpoint.slice(0, 80))
      }
    } catch (error) {
      console.warn('Push delivery failed', error)
    }
  }

  return { targeted: devices.length, delivered, removed, messageId: message.id }
}
```

Do not change `registerPushDevice()`, `readPushMessage()`, or `sendDeviceTestPush()` behavior.

- [ ] **Step 4: Remove the manual HTTP send action**

In `netlify/functions/push.mts`:

- Remove the `sendPortalPush` import.
- Remove the `MANAGEMENT` constant.
- Delete the entire `if (action === 'send') { ... }` branch.
- Retain only `subscribe`, `test`, and `unsubscribe` POST actions plus the two GET resources.

The API must return the existing `Unbekannte Push-Aktion.` response for any attempted `action: 'send'`.

- [ ] **Step 5: Remove the bell/modal UI but keep permission setup**

In `frontend/src/push-notifications.js`:

- Remove `MANAGEMENT`.
- Delete `mountAdminSender()` entirely.
- Delete the `mountAdminSender(session)` call from `setupForCurrentSession()`.
- Simplify `clearPushUi()` so it only removes the permission card; do not reference admin launcher/modal selectors.
- Preserve `ensureSubscription()`, including the automatic `action: 'test'` call when permission is granted interactively.
- Preserve iOS `isStandalone()` guidance and the `onAuthChange()` listener.

In `frontend/src/push-notifications.css`, remove selectors used only by:

```text
.habun-push-launcher
.habun-push-modal-backdrop
.habun-push-modal
.habun-push-modal-notice
.habun-push-modal-actions
```

Keep permission-card styles.

- [ ] **Step 6: Add an E2E assertion that the manual bell is gone**

In the management/admin path of `tests/e2e/unified-portal.spec.mjs`, after the portal has loaded, add:

```js
await expect(page.locator('[data-habun-push-admin]')).toHaveCount(0)
```

Do not grant notification permission in this test; it only verifies the removed manual control.

- [ ] **Step 7: Run the focused tests**

Run:

```bash
node scripts/automatic-schedule-push-source-test.mjs
npm run build:frontend
npm run test:e2e
```

Expected: source contract PASS, frontend build PASS, E2E suite PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add netlify/functions/_shared/push-core.mts netlify/functions/push.mts frontend/src/push-notifications.js frontend/src/push-notifications.css scripts/automatic-schedule-push-source-test.mjs tests/e2e/unified-portal.spec.mjs
git commit -m "refactor: remove manual push sender"
```

---

### Task 2: Add fixed schedule notification functions and hook both schedule mutation paths

**Files:**
- Create: `netlify/functions/_shared/schedule-push.mts`
- Modify: `netlify/functions/schedule-v2-neon.mts`
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `scripts/automatic-schedule-push-source-test.mjs`

**Interfaces:**
- Consumes: `sendPushToUsers()` from Task 1.
- Produces:
  ```ts
  export async function notifySchedulePublished(userIds: string[]): Promise<PushDeliveryResult | null>
  export async function notifyScheduleChanged(userIds: string[]): Promise<PushDeliveryResult | null>
  export async function notifyShiftStartingSoon(userId: string): Promise<PushDeliveryResult | null>
  ```
- These functions contain fixed copy only and catch/log delivery-layer exceptions, returning `null` on an exception so successful schedule writes are never failed by Push.

- [ ] **Step 1: Extend the failing source test with schedule hook requirements**

Append to `scripts/automatic-schedule-push-source-test.mjs`:

```js
const schedulePush = readFileSync('netlify/functions/_shared/schedule-push.mts', 'utf8')
const portalSchedule = readFileSync('netlify/functions/schedule-v2-neon.mts', 'utf8')
const assistantSchedule = readFileSync('netlify/functions/schedule-assistant.mts', 'utf8')
const commandWorker = readFileSync('netlify/functions/schedule-command-worker.mts', 'utf8')

assert.match(schedulePush, /Ein neuer Dienstplan wurde veröffentlicht\. Bitte im Mitarbeiterportal prüfen\./)
assert.match(schedulePush, /Dein Dienstplan wurde geändert\. Bitte im Mitarbeiterportal prüfen\./)
assert.match(schedulePush, /Dein Dienst beginnt gleich\. Bitte rechtzeitig einchecken\./)
assert.match(portalSchedule, /notifySchedulePublished/)
assert.match(portalSchedule, /notifyScheduleChanged/)
assert.match(assistantSchedule, /notifySchedulePublished/)
assert.match(assistantSchedule, /notifyScheduleChanged/)
assert.doesNotMatch(commandWorker, /notifySchedulePublished|notifyScheduleChanged|notifyShiftStartingSoon/)
```

- [ ] **Step 2: Run the test and verify it fails because `schedule-push.mts` and hooks do not exist**

Run:

```bash
node scripts/automatic-schedule-push-source-test.mjs
```

Expected: FAIL on missing `netlify/functions/_shared/schedule-push.mts` or missing hook assertions.

- [ ] **Step 3: Create the fixed-copy schedule notification module**

Create `netlify/functions/_shared/schedule-push.mts`:

```ts
import { sendPushToUsers, type PushDeliveryResult } from './push-core.mts'

const TITLE = 'Habun Mitarbeiterportal'
const PUBLISHED_BODY = 'Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.'
const CHANGED_BODY = 'Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.'
const STARTING_BODY = 'Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.'

function uniqueUserIds(values: string[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

async function safeSend(label: string, userIds: string[], body: string): Promise<PushDeliveryResult | null> {
  try {
    return await sendPushToUsers({ userIds: uniqueUserIds(userIds), title: TITLE, body, url: '/' })
  } catch (error) {
    console.error(`Schedule push ${label} failed`, error)
    return null
  }
}

export function notifySchedulePublished(userIds: string[]) {
  return safeSend('published', userIds, PUBLISHED_BODY)
}

export function notifyScheduleChanged(userIds: string[]) {
  return safeSend('changed', userIds, CHANGED_BODY)
}

export function notifyShiftStartingSoon(userId: string) {
  return safeSend('starting-soon', [userId], STARTING_BODY)
}
```

Do not accept custom title/body parameters from callers.

- [ ] **Step 4: Hook the normal portal schedule flow after successful mutations**

In `netlify/functions/schedule-v2-neon.mts`, import:

```ts
import { notifyScheduleChanged, notifySchedulePublished } from './_shared/schedule-push.mts'
```

In `saveShift()` after `upsertScheduleShift()` and `writeScheduleAudit()` succeed, determine published-relevant recipients using old and new state:

```ts
const affected = new Set<string>()
if (existing?.status === 'published') affected.add(existing.employeeUserId)
if (shift.status === 'published') affected.add(shift.employeeUserId)
if (affected.size) await notifyScheduleChanged([...affected])
```

This intentionally handles:
- draft -> draft: no push;
- new published shift: new employee receives change notice;
- published -> published edit: current employee receives notice;
- published A -> published B reassignment: A and B receive notice;
- published -> draft: old employee receives notice because the published assignment disappeared.

In the `delete` action, notify only after deletion/audit succeeds:

```ts
if (existing.status === 'published') await notifyScheduleChanged([existing.employeeUserId])
```

In `publishWeek()`, after `publishScheduleWeek()` and audit succeed, load the published week and dedupe recipients:

```ts
const publishedEntries = await listScheduleShifts({
  from: week,
  to: addDays(week, 6),
  publishedOnly: true,
})
await notifySchedulePublished(publishedEntries.map((entry) => entry.employeeUserId))
```

Do not send before the database operation succeeds.

- [ ] **Step 5: Hook the schedule assistant/Batch Relay flow exactly once**

In `netlify/functions/schedule-assistant.mts`, import:

```ts
import { notifyScheduleChanged, notifySchedulePublished } from './_shared/schedule-push.mts'
```

Change the successful result returned by `publishOne()` to include the resolved user ID:

```ts
return {
  index,
  employeeUserId: shift.employeeUserId,
  employeeName: shift.employeeName,
  status: 'published',
  shiftId: shift.id,
  warnings: ...,
}
```

After the full `publish-shifts` loop completes, derive only successful publication recipients and send once per batch:

```ts
const publishedUserIds = results
  .filter((entry) => entry.status === 'published')
  .map((entry) => String(entry.employeeUserId || ''))
await notifySchedulePublished(publishedUserIds)
```

All duplicate/invalid/rejected results must be excluded.

After successful `updateAssistantShift()` storage/audit, use the same old/new published-state rule:

```ts
const affected = new Set<string>()
if (existing.status === 'published') affected.add(existing.employeeUserId)
if (candidate.status === 'published') affected.add(candidate.employeeUserId)
if (affected.size) await notifyScheduleChanged([...affected])
```

After successful `deleteAssistantShift()` deletion/audit:

```ts
if (existing.status === 'published') await notifyScheduleChanged([existing.employeeUserId])
```

Do **not** modify `schedule-command-worker.mts` to send push. It already delegates to `scheduleAssistant()`, so adding another call would duplicate Batch Relay notifications.

- [ ] **Step 6: Run focused source and existing schedule tests**

Run:

```bash
node scripts/automatic-schedule-push-source-test.mjs
node scripts/schedule-assistant-source-test.mjs
node --experimental-strip-types scripts/schedule-command-worker-test.mjs
node scripts/schedule-command-worker-source-test.mjs
node scripts/schedule-neon-source-test.mjs
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add netlify/functions/_shared/schedule-push.mts netlify/functions/schedule-v2-neon.mts netlify/functions/schedule-assistant.mts scripts/automatic-schedule-push-source-test.mjs
git commit -m "feat: notify affected employees on published schedule changes"
```

---

### Task 3: Add atomic reminder persistence and pure reminder policy

**Files:**
- Create: `netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql`
- Create: `netlify/functions/_shared/schedule-reminder-core.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Create: `scripts/schedule-reminder-core-test.mjs`
- Create: `scripts/schedule-reminder-source-test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export function reminderWindow(now: Date): { fromIso: string; toIso: string }
  export function reminderKey(shift: Pick<ScheduleShift, 'id' | 'date' | 'start'>): string
  export function reminderDeliveryProcessed(result: PushDeliveryResult | null): boolean

  export async function listPublishedShiftsStartingBetween(fromIso: string, toIso: string): Promise<ScheduleShift[]>
  export async function claimSchedulePushReminder(input: {
    reminderKey: string
    shiftId: string
    employeeUserId: string
    scheduledStart: string
  }): Promise<boolean>
  export async function completeSchedulePushReminder(reminderKey: string): Promise<void>
  export async function releaseSchedulePushReminder(reminderKey: string): Promise<void>
  ```

- [ ] **Step 1: Write pure failing tests for the five-minute window, deterministic key, and retry policy**

Create `scripts/schedule-reminder-core-test.mjs`:

```js
import assert from 'node:assert/strict'
import {
  reminderDeliveryProcessed,
  reminderKey,
  reminderWindow,
} from '../netlify/functions/_shared/schedule-reminder-core.mts'

const window = reminderWindow(new Date('2026-08-16T11:00:30.000Z'))
assert.equal(window.fromIso, '2026-08-16T11:04:30.000Z')
assert.equal(window.toIso, '2026-08-16T11:06:30.000Z')

assert.equal(
  reminderKey({ id: 'shift-1', date: '2026-08-16', start: '17:00' }),
  'shift-1:2026-08-16T17:00',
)
assert.equal(
  reminderKey({ id: 'shift-1', date: '2026-08-16', start: '18:00' }),
  'shift-1:2026-08-16T18:00',
)

assert.equal(reminderDeliveryProcessed(null), false)
assert.equal(reminderDeliveryProcessed({ targeted: 0, delivered: 0, removed: 0, messageId: 'a' }), true)
assert.equal(reminderDeliveryProcessed({ targeted: 2, delivered: 1, removed: 0, messageId: 'b' }), true)
assert.equal(reminderDeliveryProcessed({ targeted: 2, delivered: 0, removed: 2, messageId: 'c' }), true)
assert.equal(reminderDeliveryProcessed({ targeted: 2, delivered: 0, removed: 1, messageId: 'd' }), false)

console.log('Schedule reminder core tests passed')
```

- [ ] **Step 2: Run the pure test and verify it fails because the module does not exist**

Run:

```bash
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure reminder policy**

Create `netlify/functions/_shared/schedule-reminder-core.mts`:

```ts
import type { ScheduleShift } from './schedule-neon-repository.mts'
import type { PushDeliveryResult } from './push-core.mts'

const MINUTE = 60_000

export function reminderWindow(now = new Date()) {
  const time = now.getTime()
  return {
    fromIso: new Date(time + 4 * MINUTE).toISOString(),
    toIso: new Date(time + 6 * MINUTE).toISOString(),
  }
}

export function reminderKey(shift: Pick<ScheduleShift, 'id' | 'date' | 'start'>) {
  return `${shift.id}:${shift.date}T${shift.start}`
}

export function reminderDeliveryProcessed(result: PushDeliveryResult | null) {
  if (!result) return false
  if (result.targeted === 0) return true
  if (result.delivered > 0) return true
  return result.removed === result.targeted
}
```

The 4–6 minute window intentionally tolerates normal scheduled-function jitter. The persistent key prevents overlap from causing duplicates.

- [ ] **Step 4: Run the pure reminder test and verify it passes**

Run:

```bash
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write the migration for atomic claim state**

Create `netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql`:

```sql
CREATE TABLE schedule_push_reminders (
  reminder_key text PRIMARY KEY,
  shift_id text NOT NULL,
  employee_user_id text NOT NULL,
  scheduled_start timestamp with time zone NOT NULL,
  state text NOT NULL DEFAULT 'claimed',
  claimed_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone,
  CONSTRAINT schedule_push_reminders_state_check CHECK (state IN ('claimed', 'sent'))
);

CREATE INDEX schedule_push_reminders_shift_idx
  ON schedule_push_reminders (shift_id, scheduled_start);

CREATE INDEX schedule_push_reminders_claim_idx
  ON schedule_push_reminders (state, claimed_at);
```

No foreign key is required: deleted/rescheduled shifts must not invalidate historical sent markers.

- [ ] **Step 6: Add repository functions with Berlin timezone conversion and atomic claim semantics**

In `netlify/functions/_shared/schedule-neon-repository.mts`, add:

```ts
export async function listPublishedShiftsStartingBetween(fromIso: string, toIso: string) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT * FROM schedule_shifts
      WHERE status = 'published'
        AND ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') >= $1::timestamptz
        AND ((shift_date + start_time) AT TIME ZONE 'Europe/Berlin') < $2::timestamptz
      ORDER BY shift_date, start_time, employee_user_id, id`,
    [fromIso, toIso],
  )
  return result.rows.map((row) => mapScheduleShiftRow(row))
}

export async function claimSchedulePushReminder(input: {
  reminderKey: string
  shiftId: string
  employeeUserId: string
  scheduledStart: string
}) {
  const database = getDatabase()
  const result = await database.pool.query(
    `INSERT INTO schedule_push_reminders (
       reminder_key, shift_id, employee_user_id, scheduled_start, state, claimed_at
     ) VALUES ($1, $2, $3, $4::timestamptz, 'claimed', now())
     ON CONFLICT (reminder_key) DO UPDATE SET
       shift_id = EXCLUDED.shift_id,
       employee_user_id = EXCLUDED.employee_user_id,
       scheduled_start = EXCLUDED.scheduled_start,
       state = 'claimed',
       claimed_at = now(),
       sent_at = NULL
     WHERE schedule_push_reminders.state = 'claimed'
       AND schedule_push_reminders.claimed_at < now() - interval '2 minutes'
     RETURNING reminder_key`,
    [input.reminderKey, input.shiftId, input.employeeUserId, input.scheduledStart],
  )
  return Boolean(result.rows[0])
}

export async function completeSchedulePushReminder(reminderKey: string) {
  const database = getDatabase()
  await database.pool.query(
    `UPDATE schedule_push_reminders
        SET state = 'sent', sent_at = now()
      WHERE reminder_key = $1 AND state = 'claimed'`,
    [reminderKey],
  )
}

export async function releaseSchedulePushReminder(reminderKey: string) {
  const database = getDatabase()
  await database.pool.query(
    `DELETE FROM schedule_push_reminders
      WHERE reminder_key = $1 AND state = 'claimed'`,
    [reminderKey],
  )
}
```

The unique primary key plus `ON CONFLICT ... WHERE claimed_at < now() - interval '2 minutes'` gives an exclusive claim while allowing recovery from a crashed worker after two minutes.

- [ ] **Step 7: Write a source/migration contract for reminder persistence**

Create `scripts/schedule-reminder-source-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const repository = readFileSync('netlify/functions/_shared/schedule-neon-repository.mts', 'utf8')
const migration = readFileSync('netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql', 'utf8')

assert.match(migration, /CREATE TABLE schedule_push_reminders/)
assert.match(migration, /reminder_key text PRIMARY KEY/)
assert.match(migration, /state IN \('claimed', 'sent'\)/)
assert.match(repository, /AT TIME ZONE 'Europe\/Berlin'/)
assert.match(repository, /export async function claimSchedulePushReminder/)
assert.match(repository, /ON CONFLICT \(reminder_key\) DO UPDATE/)
assert.match(repository, /claimed_at < now\(\) - interval '2 minutes'/)
assert.match(repository, /export async function completeSchedulePushReminder/)
assert.match(repository, /export async function releaseSchedulePushReminder/)

console.log('Schedule reminder source contract passed')
```

- [ ] **Step 8: Run reminder tests**

Run:

```bash
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
node scripts/schedule-reminder-source-test.mjs
node scripts/netlify-database-config-test.mjs
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql netlify/functions/_shared/schedule-reminder-core.mts netlify/functions/_shared/schedule-neon-repository.mts scripts/schedule-reminder-core-test.mjs scripts/schedule-reminder-source-test.mjs
git commit -m "feat: add atomic schedule reminder state"
```

---

### Task 4: Add the one-minute five-minute-before-shift reminder worker and wire verification

**Files:**
- Create: `netlify/functions/schedule-start-reminders.mts`
- Modify: `scripts/schedule-reminder-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes:
  ```ts
  reminderWindow(now)
  reminderKey(shift)
  reminderDeliveryProcessed(result)
  listPublishedShiftsStartingBetween(fromIso, toIso)
  claimSchedulePushReminder(...)
  completeSchedulePushReminder(key)
  releaseSchedulePushReminder(key)
  notifyShiftStartingSoon(userId)
  ```
- Produces: a Netlify Scheduled Function with `config.schedule = '* * * * *'`.

- [ ] **Step 1: Extend the source test to require the worker contract**

Append to `scripts/schedule-reminder-source-test.mjs`:

```js
const worker = readFileSync('netlify/functions/schedule-start-reminders.mts', 'utf8')
assert.match(worker, /schedule:\s*['"]\* \* \* \* \*['"]/)
assert.match(worker, /listPublishedShiftsStartingBetween/)
assert.match(worker, /claimSchedulePushReminder/)
assert.match(worker, /notifyShiftStartingSoon/)
assert.match(worker, /completeSchedulePushReminder/)
assert.match(worker, /releaseSchedulePushReminder/)
assert.match(worker, /reminderDeliveryProcessed/)
```

- [ ] **Step 2: Run the test and verify it fails because the worker does not exist**

Run:

```bash
node scripts/schedule-reminder-source-test.mjs
```

Expected: FAIL on missing `schedule-start-reminders.mts`.

- [ ] **Step 3: Implement the scheduled reminder worker**

Create `netlify/functions/schedule-start-reminders.mts`:

```ts
import type { Config, Context } from '@netlify/functions'
import {
  claimSchedulePushReminder,
  completeSchedulePushReminder,
  listPublishedShiftsStartingBetween,
  releaseSchedulePushReminder,
} from './_shared/schedule-neon-repository.mts'
import {
  reminderDeliveryProcessed,
  reminderKey,
  reminderWindow,
} from './_shared/schedule-reminder-core.mts'
import { notifyShiftStartingSoon } from './_shared/schedule-push.mts'

export default async function scheduleStartReminders(_request: Request, _context: Context) {
  const now = new Date()
  const { fromIso, toIso } = reminderWindow(now)
  const shifts = await listPublishedShiftsStartingBetween(fromIso, toIso)

  for (const shift of shifts) {
    const key = reminderKey(shift)
    const scheduledStart = `${shift.date}T${shift.start}:00`
    const claimed = await claimSchedulePushReminder({
      reminderKey: key,
      shiftId: shift.id,
      employeeUserId: shift.employeeUserId,
      scheduledStart,
    })
    if (!claimed) continue

    try {
      const result = await notifyShiftStartingSoon(shift.employeeUserId)
      if (reminderDeliveryProcessed(result)) {
        await completeSchedulePushReminder(key)
      } else {
        await releaseSchedulePushReminder(key)
      }
    } catch (error) {
      console.error('Schedule start reminder failed', shift.id, error)
      await releaseSchedulePushReminder(key).catch(() => {})
    }
  }
}

export const config: Config = {
  schedule: '* * * * *',
}
```

Before committing, correct `scheduledStart` so it is a valid absolute instant for the Neon `timestamptz` column. Do **not** use the timezone-less string above directly. Add a repository helper instead:

```ts
export async function scheduleShiftStartInstant(shift: Pick<ScheduleShift, 'date' | 'start'>) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT (($1::date + $2::time) AT TIME ZONE 'Europe/Berlin') AS starts_at`,
    [shift.date, shift.start],
  )
  return iso(result.rows[0]?.starts_at) || ''
}
```

Then the worker must call:

```ts
const scheduledStart = await scheduleShiftStartInstant(shift)
if (!scheduledStart) continue
```

This keeps all Berlin/DST conversion in Postgres and avoids browser/server-local timezone assumptions.

- [ ] **Step 4: Strengthen the source test for timezone-safe scheduled start**

Add:

```js
assert.match(repository, /export async function scheduleShiftStartInstant/)
assert.match(worker, /scheduleShiftStartInstant/)
assert.doesNotMatch(worker, /scheduledStart = `\$\{shift\.date\}T\$\{shift\.start\}/)
```

- [ ] **Step 5: Run reminder tests**

Run:

```bash
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
node scripts/schedule-reminder-source-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Add all new tests to `verify:unified`**

In `package.json`, append these commands after the existing push tests in `verify:unified`:

```text
node scripts/automatic-schedule-push-source-test.mjs
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
node scripts/schedule-reminder-source-test.mjs
```

Do not remove any existing verification commands.

- [ ] **Step 7: Run the complete verification/build/E2E gate**

Run:

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Expected: every command exits 0.

- [ ] **Step 8: Commit Task 4**

```bash
git add netlify/functions/schedule-start-reminders.mts netlify/functions/_shared/schedule-neon-repository.mts scripts/schedule-reminder-source-test.mjs package.json
git commit -m "feat: remind employees five minutes before published shifts"
```

---

### Task 5: Final integration review, migration/deploy verification, and real-device acceptance test

**Files:**
- Review only: all files from Tasks 1–4
- No feature code should be added in this task unless a verification failure requires a targeted fix with its own failing test first.

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: production-ready branch/PR with verified automatic schedule push and reminder behavior.

- [ ] **Step 1: Run a repository diff review against the base branch**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
```

Confirm the diff contains only the schedule-push feature, its migration, tests, and removal of the manual sender.

- [ ] **Step 2: Re-run the full gate immediately before merge**

Run:

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: all PASS.

- [ ] **Step 3: Verify the PR does not introduce a second Batch Relay push path**

Run:

```bash
grep -n "notifySchedule\|notifyShiftStartingSoon" netlify/functions/schedule-command-worker.mts && exit 1 || true
```

Expected: no matches.

- [ ] **Step 4: Merge only after CI is green and verify production deploy metadata**

After merge, verify Netlify production reports:

```text
state = ready
branch = main
commit_ref = <the merge commit>
/api/push function present
schedule-start-reminders function present
schedule-start-reminders schedule = * * * * *
secret scan matches = 0
```

Also verify the new database migration has been applied by the production build/deploy migration mechanism before relying on reminders.

- [ ] **Step 5: Real-device acceptance test for activation and publication**

On one employee test account/device that has already granted notification permission:

1. Publish a schedule containing two shifts for that same employee in one publication.
2. Confirm exactly one push appears with:
   `Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.`
3. Change one published shift.
4. Confirm exactly one push appears with:
   `Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.`
5. Confirm there is no manual bell in the portal.

Do not expose real worksite/time data in notification text while testing.

- [ ] **Step 6: Real-device acceptance test for the five-minute reminder**

Create/publish a temporary test shift starting about 7–8 minutes in the future for the test account, then wait for the scheduled worker window.

Expected: approximately five minutes before start, exactly one push appears with:

```text
Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.
```

Allow the worker to run again inside the overlapping 4–6 minute window and confirm no duplicate reminder appears.

- [ ] **Step 7: Verify draft and reassignment rules**

1. Create/edit a draft only: expect no push.
2. Reassign a published shift from test employee A to test employee B: expect one change notification for A and one for B.
3. Delete a published shift: expect one change notification for the former assignee.

- [ ] **Step 8: Record final completion commit only if acceptance fixes were needed**

If acceptance testing required code changes, each fix must have its own failing regression test and commit. If no fixes were needed, do not create an empty commit.
