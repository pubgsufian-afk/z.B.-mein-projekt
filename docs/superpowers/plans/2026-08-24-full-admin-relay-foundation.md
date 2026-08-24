# Full Admin Relay Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing encrypted PR #73 schedule relay into a typed, privacy-preserving portal-admin command transport without breaking any existing Dienstplan or Zeiterfassung command.

**Architecture:** Keep the live outer transport unchanged: PR #73 issue comment marker -> GitHub Actions OIDC -> `/api/schedule-oidc-trigger` -> encrypted result artifact. Commands without `domain` continue through the existing schedule-command parser. Commands with `domain` use a typed portal-admin parser, capability gate, router, and domain adapters. The trigger remains transport-only and contains no direct data-store writes.

**Tech Stack:** TypeScript/Netlify Functions, Node.js 22, GitHub Actions OIDC, RSA-OAEP-256 + AES-256-GCM, Netlify Identity/Admin APIs, Netlify Blobs/Database, existing Node assertion tests.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- PR #73 remains open and is never merged.
- Keep the current main-branch `issue_comment` workflow, marker `<!-- habun-schedule-envelope-v1 -->`, OIDC audience `habun-schedule-assistant`, and endpoint `/api/schedule-oidc-trigger`.
- No plaintext employee names, shift times, attendance data, report contents, response keys, or decrypted command/results in GitHub comments, logs, or commit statuses.
- No direct ad-hoc SQL in the OIDC trigger.
- Existing schedule and attendance commands remain backward compatible.
- New portal-admin commands always require a valid 32-byte `responseKey`.
- Batch size is bounded to 100 operations and item IDs are unique within a command.
- Normal cost target remains `1 targeted read -> 1 batch mutation -> 1 targeted verification`.

---

## Task 1: Add the typed portal-admin command parser

**Files:**
- Create: `netlify/functions/_shared/portal-admin-command-core.mts`
- Create: `scripts/portal-admin-command-test.mjs`

- [ ] **Step 1: Write failing parser tests**

```js
import assert from 'node:assert/strict'
import { parsePortalAdminCommand } from '../netlify/functions/_shared/portal-admin-command-core.mts'

const now = new Date('2026-08-24T16:00:00.000Z')
const responseKey = Buffer.alloc(32, 9).toString('base64')
const base = { version: 1, commandId: 'portal-1', createdAt: '2026-08-24T15:55:00.000Z', responseKey }

const inspect = parsePortalAdminCommand(JSON.stringify({
  ...base,
  domain: 'portal',
  action: 'inspect',
  input: { employeeName: 'Test Person', from: '2026-08-01', to: '2026-08-24' },
}), now)
assert.equal(inspect.ok, true)
if (!inspect.ok) throw new Error('inspect must parse')
assert.equal(inspect.command.domain, 'portal')

const batch = parsePortalAdminCommand(JSON.stringify({
  ...base,
  commandId: 'portal-batch-1',
  domain: 'portal',
  action: 'portal-batch',
  operations: [
    { itemId: '1', domain: 'schedule', action: 'update-shift', input: { shiftId: 's1', changes: { pauseMinutes: 30 } } },
    { itemId: '2', domain: 'attendance', action: 'update-session', input: { clockInEventId: 'i1', clockOutEventId: 'o1' } },
  ],
}), now)
assert.equal(batch.ok, true)
if (!batch.ok) throw new Error('batch must parse')
assert.equal(batch.command.operations?.length, 2)

assert.equal(parsePortalAdminCommand(JSON.stringify({ ...base, responseKey: '', domain: 'portal', action: 'inspect' }), now).ok, false)
assert.equal(parsePortalAdminCommand(JSON.stringify({ ...base, domain: 'unknown', action: 'inspect' }), now).ok, false)
assert.equal(parsePortalAdminCommand(JSON.stringify({
  ...base,
  domain: 'portal',
  action: 'portal-batch',
  operations: [
    { itemId: 'same', domain: 'schedule', action: 'x', input: {} },
    { itemId: 'same', domain: 'schedule', action: 'y', input: {} },
  ],
}), now).ok, false)
```

- [ ] **Step 2: Run and confirm the test fails**

```bash
node --experimental-strip-types scripts/portal-admin-command-test.mjs
```

Expected: missing module/export.

- [ ] **Step 3: Implement the parser and types**

```ts
export type PortalAdminDomain =
  | 'portal'
  | 'employees'
  | 'schedule'
  | 'attendance'
  | 'worksites'
  | 'company'
  | 'reports'

export type PortalAdminOperation = {
  itemId: string
  domain: PortalAdminDomain
  action: string
  input: Record<string, unknown>
}

export type PortalAdminCommand = {
  version: 1
  commandId: string
  createdAt: string
  domain: PortalAdminDomain
  action: string
  input?: Record<string, unknown>
  operations?: PortalAdminOperation[]
  reason?: string
  responseKey: string
}
```

Use `MAX_AGE_MS = 30 * 60 * 1000`, `MAX_OPERATIONS = 100`, and a fixed domain set. Require a non-empty command/action, fresh ISO time, valid 32-byte base64 response key, plain-object input, and for `portal-batch` 1–100 unique item IDs. Reject `operations` on non-batch commands.

- [ ] **Step 4: Run parser tests**

```bash
node --experimental-strip-types scripts/portal-admin-command-test.mjs
```

Expected: `portal admin command parser tests passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/portal-admin-command-core.mts scripts/portal-admin-command-test.mjs
git commit -m "feat: add typed portal admin command protocol"
```

---

## Task 2: Add the common result contract and router

**Files:**
- Create: `netlify/functions/_shared/portal-admin-result.mts`
- Create: `netlify/functions/_shared/portal-admin-router.mts`
- Create: `scripts/portal-admin-router-test.mjs`

- [ ] **Step 1: Write failing router tests**

```js
import assert from 'node:assert/strict'
import { createPortalAdminRouter } from '../netlify/functions/_shared/portal-admin-router.mts'

const router = createPortalAdminRouter({
  schedule: async (operation) => ({
    itemId: operation.itemId,
    domain: operation.domain,
    action: operation.action,
    status: 'success',
    data: { shiftId: operation.input.shiftId },
  }),
})

const result = await router.run({
  version: 1,
  commandId: 'batch-1',
  createdAt: new Date().toISOString(),
  domain: 'portal',
  action: 'portal-batch',
  responseKey: Buffer.alloc(32, 1).toString('base64'),
  operations: [
    { itemId: 'a', domain: 'schedule', action: 'update-shift', input: { shiftId: 's1' } },
    { itemId: 'b', domain: 'employees', action: 'get', input: { userId: 'u1' } },
  ],
})
assert.deepEqual(result.results.map((row) => row.itemId), ['a', 'b'])
assert.equal(result.results[0].status, 'success')
assert.equal(result.results[1].status, 'rejected')
assert.deepEqual(result.counts, { processed: 2, succeeded: 1, rejected: 1 })
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types scripts/portal-admin-router-test.mjs
```

- [ ] **Step 3: Implement result types**

```ts
import type { PortalAdminDomain } from './portal-admin-command-core.mts'

export type PortalAdminItemStatus = 'success' | 'duplicate' | 'not_found' | 'conflict' | 'rejected'
export type PortalAdminItemResult = {
  itemId: string
  domain: PortalAdminDomain
  action: string
  status: PortalAdminItemStatus
  code?: string
  data?: unknown
}
export type PortalAdminResult = {
  commandId: string
  domain: PortalAdminDomain
  action: string
  results: PortalAdminItemResult[]
  counts: { processed: number; succeeded: number; rejected: number }
}
```

- [ ] **Step 4: Implement ordered routing without copying operation input into results**

```ts
export function createPortalAdminRouter(
  handlers: Partial<Record<PortalAdminDomain, PortalAdminHandler>>,
) {
  return {
    async run(command: PortalAdminCommand): Promise<PortalAdminResult> {
      const operations: PortalAdminOperation[] = command.action === 'portal-batch'
        ? command.operations || []
        : [{ itemId: command.commandId, domain: command.domain, action: command.action, input: command.input || {} }]
      const results: PortalAdminItemResult[] = []
      for (const operation of operations) {
        const handler = handlers[operation.domain]
        if (!handler) {
          results.push({
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'DOMAIN_NOT_REGISTERED',
          })
          continue
        }
        try {
          results.push(await handler(operation, { commandId: command.commandId, reason: command.reason || '' }))
        } catch {
          results.push({
            itemId: operation.itemId,
            domain: operation.domain,
            action: operation.action,
            status: 'rejected',
            code: 'HANDLER_FAILED',
          })
        }
      }
      const succeeded = results.filter((row) => row.status === 'success' || row.status === 'duplicate').length
      return {
        commandId: command.commandId,
        domain: command.domain,
        action: command.action,
        results,
        counts: { processed: results.length, succeeded, rejected: results.length - succeeded },
      }
    },
  }
}
```

Before selecting a handler, add the capability check from Task 3; an unregistered action returns `ACTION_NOT_REGISTERED`.

- [ ] **Step 5: Run router tests**

```bash
node --experimental-strip-types scripts/portal-admin-router-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/portal-admin-result.mts netlify/functions/_shared/portal-admin-router.mts scripts/portal-admin-router-test.mjs
git commit -m "feat: add portal admin result and router"
```

---

## Task 3: Bootstrap the capability registry

**Files:**
- Create: `netlify/functions/_shared/portal-admin-capabilities.mts`
- Create: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-capability-registry-test.mjs`
- Modify: `netlify/functions/_shared/portal-admin-router.mts`

- [ ] **Step 1: Write failing registry tests**

Require unique IDs, valid classifications, and entries for all currently relayed schedule/attendance actions. Use the registry row shape:

```json
{
  "id": "schedule.update-shift",
  "surface": "Dienstplan",
  "endpoint": "/api/schedule-assistant",
  "method": "POST",
  "action": "update-shift",
  "classification": "relay-supported",
  "relay": { "domain": "schedule", "action": "update-shift" }
}
```

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/portal-admin-capability-registry-test.mjs
```

- [ ] **Step 3: Add the initial registry**

Include all legacy schedule/attendance actions. Do not add speculative UI actions; the exhaustive inventory belongs to Plan 4.

- [ ] **Step 4: Add typed lookup helpers**

```ts
export function portalAdminCapability(domain: PortalAdminDomain, action: string) {
  return PORTAL_ADMIN_CAPABILITIES.find((row) => row.relay?.domain === domain && row.relay?.action === action) || null
}

export function portalAdminActionAllowed(domain: PortalAdminDomain, action: string) {
  const capability = portalAdminCapability(domain, action)
  return capability?.classification === 'relay-supported' || capability?.classification === 'relay-read-only'
}
```

Call `portalAdminActionAllowed` in the router before invoking any domain handler.

- [ ] **Step 5: Run registry + router tests**

```bash
node scripts/portal-admin-capability-registry-test.mjs
node --experimental-strip-types scripts/portal-admin-router-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/portal-admin-capabilities.mts ops/portal-admin-capabilities.json scripts/portal-admin-capability-registry-test.mjs netlify/functions/_shared/portal-admin-router.mts
git commit -m "feat: register portal admin capabilities"
```

---

## Task 4: Add backward-compatible schedule and attendance adapters

**Files:**
- Create: `netlify/functions/_shared/portal-admin-schedule.mts`
- Create: `netlify/functions/_shared/portal-admin-attendance.mts`
- Create: `scripts/portal-admin-adapter-source-test.mjs`

- [ ] **Step 1: Write failing source tests**

Assert both adapters use the existing assistants, never import direct DB clients, and map assistant results to `PortalAdminItemResult`.

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/portal-admin-adapter-source-test.mjs
```

- [ ] **Step 3: Implement thin internal Request adapters**

For schedule, call `scheduleAssistant` with the existing internal token and body `{ action, requestId, ...input }`. Attendance mirrors this with `attendanceAssistant`. Implement a `mapAssistantResponse` helper that returns only item ID, domain, action, status, code, and bounded safe data; never echo `operation.input`.

- [ ] **Step 4: Run existing assistant regressions**

```bash
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
node --experimental-strip-types scripts/attendance-assistant-core-test.mjs
node scripts/portal-admin-adapter-source-test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/portal-admin-schedule.mts netlify/functions/_shared/portal-admin-attendance.mts scripts/portal-admin-adapter-source-test.mjs
git commit -m "feat: bridge existing assistants into portal admin relay"
```

---

## Task 5: Route new commands through the existing OIDC endpoint

**Files:**
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Modify: `scripts/run-schedule-oidc-relay.mjs`
- Create: `scripts/portal-admin-oidc-source-test.mjs`
- Modify: `scripts/schedule-oidc-trigger-source-test.mjs`
- Modify: `scripts/attendance-oidc-trigger-source-test.mjs`

- [ ] **Step 1: Write a failing dual-protocol source test**

Assert OIDC verification occurs before decrypt; decrypt occurs before either parser; both `parsePortalAdminCommand` and `parseScheduleCommand` remain; no direct DB client appears in the trigger.

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/portal-admin-oidc-source-test.mjs
```

- [ ] **Step 3: Implement dual-protocol routing**

After OIDC verification, public-key-request handling, and command decryption:

```ts
const isPortalAdmin = Boolean(String(command.domain || '').trim())
if (isPortalAdmin) {
  const parsed = parsePortalAdminCommand(JSON.stringify(command), new Date())
  if (!parsed.ok) return json({ message: parsed.message }, 400)
  const router = createPortalAdminRouter({
    schedule: createSchedulePortalAdminHandler(context),
    attendance: createAttendancePortalAdminHandler(context),
  })
  const data = await router.run(parsed.command)
  const encryptedResult = encryptAssistantResult(data, parsed.command.responseKey)
  return json({
    commandHash: createHash('sha256').update(parsed.command.commandId).digest('hex').slice(0, 12),
    action: parsed.command.action,
    succeededCount: data.counts.succeeded,
    rejectedCount: data.counts.rejected,
    results: data.results.map(({ itemId, domain, action, status, code }) => ({ itemId, domain, action, status, code })),
    encryptedResult,
  })
}
```

Commands without `domain` continue into the current schedule-command parser/assistant path unchanged.

- [ ] **Step 4: Extend the runner only with safe generic aggregate output**

```js
const succeededCount = count(result?.succeededCount ?? 0)
if (result?.succeededCount !== undefined) {
  console.log(`Habun portal admin OIDC relay: succeeded=${succeededCount} rejected=${rejectedCount}`)
}
```

Keep the current legacy summary output too.

- [ ] **Step 5: Run transport regressions**

```bash
node scripts/portal-admin-oidc-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/attendance-oidc-trigger-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/schedule-oidc-trigger.mts scripts/run-schedule-oidc-relay.mjs scripts/portal-admin-oidc-source-test.mjs scripts/schedule-oidc-trigger-source-test.mjs scripts/attendance-oidc-trigger-source-test.mjs
git commit -m "feat: route portal admin commands through oidc relay"
```

---

## Task 6: Foundation regression verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add focused verification**

```json
"verify:portal-admin-foundation": "node --experimental-strip-types scripts/portal-admin-command-test.mjs && node --experimental-strip-types scripts/portal-admin-router-test.mjs && node scripts/portal-admin-capability-registry-test.mjs && node scripts/portal-admin-adapter-source-test.mjs && node scripts/portal-admin-oidc-source-test.mjs && node scripts/schedule-oidc-workflow-source-test.mjs"
```

- [ ] **Step 2: Run focused verification**

```bash
npm run verify:portal-admin-foundation
```

- [ ] **Step 3: Run existing relay/assistant regressions**

```bash
node scripts/schedule-command-worker-test.mjs
node scripts/attendance-command-worker-test.mjs
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/attendance-oidc-trigger-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
```

- [ ] **Step 4: Run full verification**

```bash
npm run verify
```

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "test: verify portal admin relay foundation"
```

## Foundation Done Criteria

- Existing PR #73 issue-comment relay behavior remains intact.
- Legacy schedule/attendance encrypted commands still work unchanged.
- New commands with `domain` are capability-checked, routed, and returned as encrypted detailed results.
- Trigger still verifies OIDC before decrypt and contains no direct data-store writes.
- Public GitHub-facing metadata remains aggregate/privacy-safe.
- Foundation is ready for Plans 2–4.