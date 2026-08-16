# Automatic Schedule Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically notify only affected employees when published schedules are created, changed, or deleted, and remind each assigned employee about five minutes before a published shift starts, with no manual notification bell.

**Architecture:** Keep the existing device registration, service worker, VAPID keys, and per-device activation test. Remove arbitrary/manual push sending from the UI and HTTP API, add a fixed-copy server-side schedule push module, call it only after successful published schedule mutations in both schedule entry paths, and add a one-minute scheduled reminder worker backed by an atomic Neon claim table so retries do not create duplicate reminders.

**Tech Stack:** React/Vite, Netlify Functions, Netlify Scheduled Functions, `@netlify/identity`, `@netlify/blobs`, `@netlify/database`/Neon Postgres, Node.js 24, existing Web Push/VAPID code, Node `assert` tests, Playwright.

## Global Constraints

- Draft-only changes never notify.
- A new publication notifies each included employee once per publication, even with multiple shifts.
- Later published changes/deletions notify only affected employees.
- Published reassignment A -> B notifies A and B.
- Reminder copy is exactly `Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.`
- Publication copy is exactly `Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.`
- Change copy is exactly `Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.`
- Push text contains no shift time, worksite, or other schedule details.
- The manual bell/free-text sender is removed from UI and HTTP API.
- Push activation, iPhone Home-Screen guidance, subscription sync, unsubscribe, and one-time test push remain.
- Successful schedule writes are never rolled back because Push fails.
- Batch Relay inherits notifications through `schedule-assistant.mts`; `schedule-command-worker.mts` must not send Push itself.
- Reminder time conversion uses Postgres `Europe/Berlin` so DST is correct.
- No browser polling is added.

---

## File Map

**Create**
- `netlify/functions/_shared/schedule-push.mts`
- `netlify/functions/_shared/schedule-reminder-core.mts`
- `netlify/functions/schedule-start-reminders.mts`
- `netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql`
- `scripts/automatic-schedule-push-source-test.mjs`
- `scripts/schedule-reminder-core-test.mjs`
- `scripts/schedule-reminder-source-test.mjs`

**Modify**
- `netlify/functions/_shared/push-core.mts`
- `netlify/functions/push.mts`
- `frontend/src/push-notifications.js`
- `frontend/src/push-notifications.css`
- `netlify/functions/_shared/schedule-neon-repository.mts`
- `netlify/functions/schedule-v2-neon.mts`
- `netlify/functions/schedule-assistant.mts`
- `tests/e2e/unified-portal.spec.mjs`
- `package.json`

---

### Task 1: Remove manual Push and expose a server-only targeted delivery primitive

**Files:**
- Modify: `netlify/functions/_shared/push-core.mts`
- Modify: `netlify/functions/push.mts`
- Modify: `frontend/src/push-notifications.js`
- Modify: `frontend/src/push-notifications.css`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Create: `scripts/automatic-schedule-push-source-test.mjs`

**Interfaces:**
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
- Empty `userIds` means “send to nobody”, never broadcast.
- Per-device storage/delivery errors are caught inside `sendPushToUsers()` so a later device failure cannot turn a partially successful send into a thrown operation.

- [ ] **Step 1: Write the failing manual-sender removal test**

Create `scripts/automatic-schedule-push-source-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const frontend = readFileSync('frontend/src/push-notifications.js', 'utf8')
const pushApi = readFileSync('netlify/functions/push.mts', 'utf8')
const pushCore = readFileSync('netlify/functions/_shared/push-core.mts', 'utf8')

assert.doesNotMatch(frontend, /mountAdminSender|data-habun-push-admin/)
assert.doesNotMatch(pushApi, /action === ['"]send['"]|sendPortalPush/)
assert.doesNotMatch(pushCore, /export async function sendPortalPush/)
assert.match(pushCore, /export async function sendPushToUsers/)
assert.match(pushCore, /userIds:\s*string\[\]/)

console.log('Automatic schedule push source contract passed')
```

- [ ] **Step 2: Run it and confirm RED**

```bash
node scripts/automatic-schedule-push-source-test.mjs
```

Expected: FAIL because the bell/manual send path still exists.

- [ ] **Step 3: Replace `sendPortalPush()` with targeted `sendPushToUsers()`**

In `push-core.mts`:
- Remove the `MANAGEMENT` constant and `actorRole` from the low-level delivery primitive.
- Keep device registration/message read/test behavior unchanged.
- Clean/dedupe `userIds` first.
- Build one `PushMessage` per operation.
- Return zero counts immediately for an empty recipient set.
- Filter `listDevices()` by recipient user IDs.
- Obtain VAPID config only when at least one device exists.
- Put `store().setJSON(...)` and `sendWake(...)` for each device inside that device’s `try/catch`.
- Continue deleting 404/410 endpoints.
- Return counts after all devices are attempted.

Key shape:

```ts
const recipients = new Set(
  options.userIds.map((value) => String(value || '').trim()).filter(Boolean),
)
const message: PushMessage = {
  id: crypto.randomUUID(),
  title,
  body,
  url,
  createdAt: new Date().toISOString(),
}
if (!recipients.size) return { targeted: 0, delivered: 0, removed: 0, messageId: message.id }
```

- [ ] **Step 4: Remove manual HTTP sending**

In `push.mts`:
- Remove `sendPortalPush` import and `MANAGEMENT`.
- Delete the entire `if (action === 'send')` block.
- Keep GET `public-key`, GET `message`, POST `subscribe`, POST `test`, POST `unsubscribe`.
- Attempted `action: 'send'` must fall through to `Unbekannte Push-Aktion.`.

- [ ] **Step 5: Remove bell/modal UI**

In `push-notifications.js`:
- Remove `MANAGEMENT`.
- Remove `mountAdminSender()` and its call.
- Make `clearPushUi()` remove only the permission card.
- Preserve activation test in `ensureSubscription()`.
- Preserve iOS Home-Screen guidance and `onAuthChange()`.

In `push-notifications.css`, remove only launcher/modal/backdrop styles (`.habun-push-launcher`, `.habun-push-modal-*`). Keep permission-card styles.

- [ ] **Step 6: Add E2E absence assertion**

In the authenticated admin/management flow of `tests/e2e/unified-portal.spec.mjs`:

```js
await expect(page.locator('[data-habun-push-admin]')).toHaveCount(0)
```

- [ ] **Step 7: Run focused verification**

```bash
node scripts/automatic-schedule-push-source-test.mjs
npm run build:frontend
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/_shared/push-core.mts netlify/functions/push.mts frontend/src/push-notifications.js frontend/src/push-notifications.css scripts/automatic-schedule-push-source-test.mjs tests/e2e/unified-portal.spec.mjs
git commit -m "refactor: remove manual push sender"
```

---

### Task 2: Add fixed schedule Push copy and event hooks for portal + Batch Relay

**Files:**
- Create: `netlify/functions/_shared/schedule-push.mts`
- Modify: `netlify/functions/schedule-v2-neon.mts`
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `scripts/automatic-schedule-push-source-test.mjs`

**Interfaces:**
- Consumes: `sendPushToUsers()` from Task 1.
- Produces:
  ```ts
  notifySchedulePublished(userIds: string[]): Promise<PushDeliveryResult | null>
  notifyScheduleChanged(userIds: string[]): Promise<PushDeliveryResult | null>
  notifyShiftStartingSoon(userId: string): Promise<PushDeliveryResult | null>
  ```
- These functions use fixed copy and catch/log top-level delivery failures so Push never fails a successful schedule mutation.

- [ ] **Step 1: Extend the source test and confirm RED**

Append:

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

Run `node scripts/automatic-schedule-push-source-test.mjs`; expect FAIL.

- [ ] **Step 2: Create `schedule-push.mts`**

```ts
import { sendPushToUsers, type PushDeliveryResult } from './push-core.mts'

const TITLE = 'Habun Mitarbeiterportal'
const PUBLISHED = 'Ein neuer Dienstplan wurde veröffentlicht. Bitte im Mitarbeiterportal prüfen.'
const CHANGED = 'Dein Dienstplan wurde geändert. Bitte im Mitarbeiterportal prüfen.'
const STARTING = 'Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.'

function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

async function safe(label: string, userIds: string[], body: string): Promise<PushDeliveryResult | null> {
  try {
    return await sendPushToUsers({ userIds: unique(userIds), title: TITLE, body, url: '/' })
  } catch (error) {
    console.error(`Schedule push ${label} failed`, error)
    return null
  }
}

export const notifySchedulePublished = (userIds: string[]) => safe('published', userIds, PUBLISHED)
export const notifyScheduleChanged = (userIds: string[]) => safe('changed', userIds, CHANGED)
export const notifyShiftStartingSoon = (userId: string) => safe('starting-soon', [userId], STARTING)
```

- [ ] **Step 3: Hook normal portal mutations after DB success**

In `schedule-v2-neon.mts`, import `notifyScheduleChanged` and `notifySchedulePublished`.

After `saveShift()` storage/audit succeeds:

```ts
const affected = new Set<string>()
if (existing?.status === 'published') affected.add(existing.employeeUserId)
if (shift.status === 'published') affected.add(shift.employeeUserId)
if (affected.size) await notifyScheduleChanged([...affected])
```

This yields no push for draft->draft; old+new recipients for published reassignment; old recipient for published->draft.

After successful delete/audit:

```ts
if (existing.status === 'published') await notifyScheduleChanged([existing.employeeUserId])
```

After `publishScheduleWeek()` and audit succeed:

```ts
const publishedEntries = await listScheduleShifts({
  from: week,
  to: addDays(week, 6),
  publishedOnly: true,
})
await notifySchedulePublished(publishedEntries.map((entry) => entry.employeeUserId))
```

- [ ] **Step 4: Hook assistant/Batch Relay once**

In `schedule-assistant.mts`:
- Import `notifyScheduleChanged`, `notifySchedulePublished`.
- Add `employeeUserId: shift.employeeUserId` to successful `publishOne()` results.
- After the complete `publish-shifts` loop:

```ts
const publishedUserIds = results
  .filter((entry) => entry.status === 'published')
  .map((entry) => String(entry.employeeUserId || ''))
await notifySchedulePublished(publishedUserIds)
```

- After successful update/audit, use the same old/new published-state recipient set as portal save.
- After successful delete/audit, notify former assignee only when the deleted shift was published.
- Do not add Push code to `schedule-command-worker.mts`.

- [ ] **Step 5: Run regressions**

```bash
node scripts/automatic-schedule-push-source-test.mjs
node scripts/schedule-assistant-source-test.mjs
node --experimental-strip-types scripts/schedule-command-worker-test.mjs
node scripts/schedule-command-worker-source-test.mjs
node scripts/schedule-neon-source-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/schedule-push.mts netlify/functions/schedule-v2-neon.mts netlify/functions/schedule-assistant.mts scripts/automatic-schedule-push-source-test.mjs
git commit -m "feat: notify affected employees on published schedule changes"
```

---

### Task 3: Add atomic at-most-once reminder state and timezone-safe schedule queries

**Files:**
- Create: `netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql`
- Create: `netlify/functions/_shared/schedule-reminder-core.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Create: `scripts/schedule-reminder-core-test.mjs`
- Create: `scripts/schedule-reminder-source-test.mjs`

**Interfaces:**
- Produces:
  ```ts
  reminderWindow(now: Date): { fromIso: string; toIso: string }
  reminderKey(shift: Pick<ScheduleShift, 'id' | 'date' | 'start'>): string
  reminderDeliveryProcessed(result: PushDeliveryResult | null): boolean
  listPublishedShiftsStartingBetween(fromIso: string, toIso: string): Promise<ScheduleShift[]>
  scheduleShiftStartInstant(shift: Pick<ScheduleShift, 'date' | 'start'>): Promise<string>
  claimSchedulePushReminder(...): Promise<boolean>
  completeSchedulePushReminder(reminderKey: string): Promise<void>
  releaseSchedulePushReminder(reminderKey: string): Promise<void>
  ```

**Reliability rule:** A claim never expires automatically. The worker releases it only when the returned delivery result proves no device received the reminder. If a process crashes after a possible send, the retained claim prevents a duplicate.

- [ ] **Step 1: Write pure reminder tests and confirm RED**

Create `scripts/schedule-reminder-core-test.mjs`:

```js
import assert from 'node:assert/strict'
import { reminderDeliveryProcessed, reminderKey, reminderWindow } from '../netlify/functions/_shared/schedule-reminder-core.mts'

const window = reminderWindow(new Date('2026-08-16T11:00:30.000Z'))
assert.equal(window.fromIso, '2026-08-16T11:04:30.000Z')
assert.equal(window.toIso, '2026-08-16T11:06:30.000Z')
assert.equal(reminderKey({ id: 's1', date: '2026-08-16', start: '17:00' }), 's1:2026-08-16T17:00')
assert.equal(reminderKey({ id: 's1', date: '2026-08-16', start: '18:00' }), 's1:2026-08-16T18:00')
assert.equal(reminderDeliveryProcessed(null), false)
assert.equal(reminderDeliveryProcessed({ targeted: 0, delivered: 0, removed: 0, messageId: 'a' }), true)
assert.equal(reminderDeliveryProcessed({ targeted: 2, delivered: 1, removed: 0, messageId: 'b' }), true)
assert.equal(reminderDeliveryProcessed({ targeted: 2, delivered: 0, removed: 2, messageId: 'c' }), true)
assert.equal(reminderDeliveryProcessed({ targeted: 2, delivered: 0, removed: 1, messageId: 'd' }), false)
console.log('Schedule reminder core tests passed')
```

Run `node --experimental-strip-types scripts/schedule-reminder-core-test.mjs`; expect module-not-found FAIL.

- [ ] **Step 2: Implement pure helper**

Create `schedule-reminder-core.mts`:

```ts
import type { ScheduleShift } from './schedule-neon-repository.mts'
import type { PushDeliveryResult } from './push-core.mts'

const MINUTE = 60_000

export function reminderWindow(now = new Date()) {
  return {
    fromIso: new Date(now.getTime() + 4 * MINUTE).toISOString(),
    toIso: new Date(now.getTime() + 6 * MINUTE).toISOString(),
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

- [ ] **Step 3: Add migration**

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
```

- [ ] **Step 4: Add timezone-safe query/start conversion**

In `schedule-neon-repository.mts`:

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

export async function scheduleShiftStartInstant(shift: Pick<ScheduleShift, 'date' | 'start'>) {
  const database = getDatabase()
  const result = await database.pool.query(
    `SELECT (($1::date + $2::time) AT TIME ZONE 'Europe/Berlin') AS starts_at`,
    [shift.date, shift.start],
  )
  return iso(result.rows[0]?.starts_at) || ''
}
```

- [ ] **Step 5: Add single-winner claim/complete/release functions**

```ts
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
     ON CONFLICT (reminder_key) DO NOTHING
     RETURNING reminder_key`,
    [input.reminderKey, input.shiftId, input.employeeUserId, input.scheduledStart],
  )
  return Boolean(result.rows[0])
}

export async function completeSchedulePushReminder(reminderKey: string) {
  const database = getDatabase()
  await database.pool.query(
    `UPDATE schedule_push_reminders SET state = 'sent', sent_at = now()
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

- [ ] **Step 6: Write source/migration contract**

Create `scripts/schedule-reminder-source-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const repository = readFileSync('netlify/functions/_shared/schedule-neon-repository.mts', 'utf8')
const migration = readFileSync('netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql', 'utf8')

assert.match(migration, /CREATE TABLE schedule_push_reminders/)
assert.match(migration, /reminder_key text PRIMARY KEY/)
assert.match(repository, /AT TIME ZONE 'Europe\/Berlin'/)
assert.match(repository, /ON CONFLICT \(reminder_key\) DO NOTHING/)
assert.doesNotMatch(repository, /claimed_at < now\(\)/)
assert.match(repository, /export async function scheduleShiftStartInstant/)
assert.match(repository, /export async function completeSchedulePushReminder/)
assert.match(repository, /export async function releaseSchedulePushReminder/)

console.log('Schedule reminder source contract passed')
```

- [ ] **Step 7: Run tests and commit**

```bash
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
node scripts/schedule-reminder-source-test.mjs
node scripts/netlify-database-config-test.mjs
git add netlify/database/migrations/20260816111000_create-schedule-push-reminders/migration.sql netlify/functions/_shared/schedule-reminder-core.mts netlify/functions/_shared/schedule-neon-repository.mts scripts/schedule-reminder-core-test.mjs scripts/schedule-reminder-source-test.mjs
git commit -m "feat: add at-most-once schedule reminder state"
```

Expected: tests PASS before commit.

---

### Task 4: Add the one-minute reminder worker and wire CI

**Files:**
- Create: `netlify/functions/schedule-start-reminders.mts`
- Modify: `scripts/schedule-reminder-source-test.mjs`
- Modify: `package.json`

**Interfaces:** Consumes Tasks 2–3 and produces a Scheduled Function with `schedule: '* * * * *'`.

- [ ] **Step 1: Extend source test and confirm RED**

Append:

```js
const worker = readFileSync('netlify/functions/schedule-start-reminders.mts', 'utf8')
assert.match(worker, /schedule:\s*['"]\* \* \* \* \*['"]/)
assert.match(worker, /listPublishedShiftsStartingBetween/)
assert.match(worker, /scheduleShiftStartInstant/)
assert.match(worker, /claimSchedulePushReminder/)
assert.match(worker, /notifyShiftStartingSoon/)
assert.match(worker, /completeSchedulePushReminder/)
assert.match(worker, /releaseSchedulePushReminder/)
```

Run `node scripts/schedule-reminder-source-test.mjs`; expect missing-worker FAIL.

- [ ] **Step 2: Implement scheduled worker**

Create `schedule-start-reminders.mts`:

```ts
import type { Config, Context } from '@netlify/functions'
import {
  claimSchedulePushReminder,
  completeSchedulePushReminder,
  listPublishedShiftsStartingBetween,
  releaseSchedulePushReminder,
  scheduleShiftStartInstant,
} from './_shared/schedule-neon-repository.mts'
import { reminderDeliveryProcessed, reminderKey, reminderWindow } from './_shared/schedule-reminder-core.mts'
import { notifyShiftStartingSoon } from './_shared/schedule-push.mts'

export default async function scheduleStartReminders(_request: Request, _context: Context) {
  const { fromIso, toIso } = reminderWindow(new Date())
  const shifts = await listPublishedShiftsStartingBetween(fromIso, toIso)

  for (const shift of shifts) {
    const key = reminderKey(shift)
    const scheduledStart = await scheduleShiftStartInstant(shift)
    if (!scheduledStart) continue

    const claimed = await claimSchedulePushReminder({
      reminderKey: key,
      shiftId: shift.id,
      employeeUserId: shift.employeeUserId,
      scheduledStart,
    })
    if (!claimed) continue

    const result = await notifyShiftStartingSoon(shift.employeeUserId)
    if (reminderDeliveryProcessed(result)) {
      await completeSchedulePushReminder(key)
    } else {
      await releaseSchedulePushReminder(key)
    }
  }
}

export const config: Config = { schedule: '* * * * *' }
```

The overlapping 4–6 minute scan is deduplicated by the reminder primary key. A known zero-delivery result may release for retry; any possible/confirmed delivery retains the claim.

- [ ] **Step 3: Add tests to `verify:unified`**

Append without removing existing commands:

```text
node scripts/automatic-schedule-push-source-test.mjs
node --experimental-strip-types scripts/schedule-reminder-core-test.mjs
node scripts/schedule-reminder-source-test.mjs
```

- [ ] **Step 4: Run full gate**

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/schedule-start-reminders.mts scripts/schedule-reminder-source-test.mjs package.json
git commit -m "feat: remind employees before published shifts"
```

---

### Task 5: Merge/deploy verification and real-device acceptance

**Files:** Review Tasks 1–4 only. Add code only after a failing regression test reproduces an acceptance failure.

- [ ] **Step 1: Diff + final verification**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
npm run verify
npm run build
npm run test:e2e
```

Expected: no diff errors and all tests PASS.

- [ ] **Step 2: Verify no second Batch Relay Push path**

```bash
grep -n "notifySchedule\|notifyShiftStartingSoon" netlify/functions/schedule-command-worker.mts && exit 1 || true
```

Expected: no output.

- [ ] **Step 3: Merge only with green CI, then verify Netlify production**

Production must show:

```text
state = ready
branch = main
commit_ref = merge commit
/api/push present
schedule-start-reminders present
schedule-start-reminders cron = * * * * *
secret scan matches = 0
```

Verify the `schedule_push_reminders` migration is applied before relying on reminders.

- [ ] **Step 4: Real-device publication/change acceptance**

Using a registered test employee device:
1. Publish a plan with two shifts for the same employee -> exactly one publication push.
2. Change one published shift -> exactly one change push.
3. Confirm no manual bell exists.
4. Edit draft only -> no push.
5. Reassign a published shift A -> B -> one change push to A and one to B.
6. Delete a published shift -> one change push to former assignee.

- [ ] **Step 5: Real-device five-minute reminder acceptance**

Publish a temporary test shift starting about 7–8 minutes in the future. Expect exactly one push approximately five minutes before start:

```text
Dein Dienst beginnt gleich. Bitte rechtzeitig einchecken.
```

Allow another scheduled run inside the overlapping reminder window and confirm no duplicate appears.

- [ ] **Step 6: If acceptance finds a bug, write a failing regression test before the fix**

If no fix is required, do not create an empty commit.
