# Full Admin Relay Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the existing encrypted PR #73 schedule relay into a typed, privacy-preserving portal-admin command transport without breaking any existing Dienstplan or Zeiterfassung command.

**Architecture:** Keep the live outer transport unchanged: PR #73 issue comment marker -> GitHub Actions OIDC -> `/api/schedule-oidc-trigger` -> encrypted result artifact. Add a second, typed portal-admin protocol inside the decrypted payload. Commands without `domain` continue through the existing `parseScheduleCommand` path. Commands with `domain` use a new portal-admin parser/router and domain adapters. The trigger remains transport-only and must never contain direct database writes.

**Tech Stack:** TypeScript/Netlify Functions, Node.js 22, GitHub Actions OIDC, RSA-OAEP-256 + AES-256-GCM, Netlify Identity/Admin APIs, Netlify Blobs/Database, existing Node assertion test suite.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- PR #73 remains open and is never merged.
- Keep the current main-branch `issue_comment` workflow, marker `<!-- habun-schedule-envelope-v1 -->`, OIDC audience `habun-schedule-assistant`, and endpoint `/api/schedule-oidc-trigger` unless a later reviewed migration explicitly replaces them.
- No plaintext employee names, shift times, attendance data, report contents, response keys, or decrypted command/results in GitHub comments, logs, or commit statuses.
- No direct ad-hoc SQL in the OIDC trigger.
- No browser automation or deploy is introduced as a normal portal-data path.
- Existing schedule and attendance commands remain backward compatible.
- New portal-admin commands always require a valid 32-byte `responseKey` so detailed results stay encrypted.
- Batch size is bounded to 100 operations; retries are idempotent by command/item ID.
- Cost target for normal user work remains `1 targeted read -> 1 batch mutation -> 1 targeted verification`.

---

## Task 1: Add the typed portal-admin command parser

**Files:**
- Create: `netlify/functions/_shared/portal-admin-command-core.mts`
- Create: `scripts/portal-admin-command-test.mjs`

- [ ] **Step 1: Write failing parser tests**

Create tests that accept a single-domain command and a `portal-batch`, and reject expired, malformed, oversized, missing-response-key, duplicate-item-ID, and unknown-domain commands.

```js
import assert from 'node:assert/strict'
import { parsePortalAdminCommand } from '../netlify/functions/_shared/portal-admin-command-core.mts'

const now = new Date('2026-08-24T16:00:00.000Z')
const responseKey = Buffer.alloc(32, 9).toString('base64')
const base = {
  version: 1,
  commandId: 'portal-1',
  createdAt: '2026-08-24T15:55:00.000Z',
  responseKey,
}

const inspect = parsePortalAdminCommand(JSON.stringify({
  ...base,
  domain: 'portal',
  action: 'inspect',
  input: { employeeName: 'Test Person', from: '2026-08-01', to: '2026-08-24' },
}), now)
assert.equal(inspect.ok, true)
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
assert.equal(batch.command.operations.length, 2)

assert.equal(parsePortalAdminCommand(JSON.stringify({ ...base, responseKey: '', domain: 'portal', action: 'inspect' }), now).ok, false)
assert.equal(parsePortalAdminCommand(JSON.stringify({ ...base, domain: 'unknown', action: 'inspect' }), now).ok, false)
assert.equal(parsePortalAdminCommand(JSON.stringify({
  ...base,
  domain: 'portal', action: 'portal-batch',
  operations: [
    { itemId: 'same', domain: 'schedule', action: 'x', input: {} },
    { itemId: 'same', domain: 'schedule', action: 'y', input: {} },
  ],
}), now).ok, false)
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
node --experimental-strip-types scripts/portal-admin-command-test.mjs
```

Expected: module-not-found or missing-export failure for `portal-admin-command-core.mts`.

- [ ] **Step 3: Implement the parser and types**

Use this public contract:

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

Validation rules:

```ts
const MAX_AGE_MS = 30 * 60 * 1000
const MAX_OPERATIONS = 100
const DOMAINS = new Set<PortalAdminDomain>([
  'portal', 'employees', 'schedule', 'attendance', 'worksites', 'company', 'reports',
])

function validResponseKey(value: unknown) {
  try { return Buffer.from(String(value || '').trim(), 'base64').length === 32 }
  catch { return false }
}
```

Require non-empty `commandId`, valid fresh ISO `createdAt`, known domain, non-empty action, valid response key, plain-object `input`, and for `portal-batch` 1–100 operations with unique non-empty `itemId`s and known domains. Reject `operations` for non-batch commands to keep the protocol unambiguous.

- [ ] **Step 4: Run parser tests**

Run:

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

## Task 2: Add a common encrypted-result contract and router

**Files:**
- Create: `netlify/functions/_shared/portal-admin-result.mts`
- Create: `netlify/functions/_shared/portal-admin-router.mts`
- Create: `scripts/portal-admin-router-test.mjs`

- [ ] **Step 1: Write failing router tests**

Test single operation, ordered batch results, missing handler, handler conflict, and per-item exception isolation.

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
assert.equal(result.counts.processed, 2)
assert.equal(result.counts.succeeded, 1)
assert.equal(result.counts.rejected, 1)
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types scripts/portal-admin-router-test.mjs
```

Expected: missing module/export.

- [ ] **Step 3: Implement result types**

```ts
import type { PortalAdminDomain } from './portal-admin-command-core.mts'

export type PortalAdminItemStatus =
  | 'success'
  | 'duplicate'
  | 'not_found'
  | 'conflict'
  | 'rejected'

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

Count `success` and `duplicate` as succeeded; all other statuses as rejected.

- [ ] **Step 4: Implement the router**

The router accepts registered domain handlers. A `portal-batch` executes operations in input order. Do not use uncontrolled `Promise.all` across mutations; preserving order avoids cross-domain race conditions. Each handler exception becomes a privacy-safe `rejected` item with code `HANDLER_FAILED`; the decrypted artifact may include a bounded non-secret message, but the public relay response must not.

```ts
export type PortalAdminHandler = (
  operation: PortalAdminOperation,
  context: { commandId: string; reason: string },
) => Promise<PortalAdminItemResult>

export function createPortalAdminRouter(
  handlers: Partial<Record<PortalAdminDomain, PortalAdminHandler>>,
) {
  return {
    async run(command: PortalAdminCommand): Promise<PortalAdminResult> {
      const operations = command.action === 'portal-batch'
        ? command.operations || []
        : [{ itemId: command.commandId, domain: command.domain, action: command.action, input: command.input || {} }]
      const results: PortalAdminItemResult[] = []
      for (const operation of operations) {
        const handler = handlers[operation.domain]
        if (!handler) {
          results.push({ ...operation, status: 'rejected', code: 'DOMAIN_NOT_REGISTERED' })
          continue
        }
        try {
          results.push(await handler(operation, { commandId: command.commandId, reason: command.reason || '' }))
        } catch {
          results.push({ itemId: operation.itemId, domain: operation.domain, action: operation.action, status: 'rejected', code: 'HANDLER_FAILED' })
        }
      }
      // Return counts derived from results.
    },
  }
}
```

Do not spread `operation` into result objects in production because it would copy `input`; explicitly return only safe result fields.

- [ ] **Step 5: Run router tests**

```bash
node --experimental-strip-types scripts/portal-admin-router-test.mjs
```

Expected: pass.

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

- [ ] **Step 1: Write failing registry tests**

The foundation registry must at least classify the protocol-level and currently relayed schedule/attendance actions. Full UI inventory is completed in Plan 4.

```js
import assert from 'node:assert/strict'
import registry from '../ops/portal-admin-capabilities.json' with { type: 'json' }

const allowed = new Set(['relay-supported', 'relay-read-only', 'excluded-security'])
assert.ok(registry.length > 0)
assert.equal(new Set(registry.map((row) => row.id)).size, registry.length)
for (const row of registry) assert.ok(allowed.has(row.classification), row.id)
for (const id of [
  'schedule.publish-shifts',
  'schedule.list-shifts',
  'schedule.update-shift',
  'schedule.delete-shift',
  'attendance.list',
  'attendance.update-session',
  'attendance.delete-events',
]) assert.ok(registry.some((row) => row.id === id), `missing ${id}`)
```

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/portal-admin-capability-registry-test.mjs
```

- [ ] **Step 3: Add the initial JSON registry**

Use rows shaped like:

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

Add all legacy relay schedule and attendance actions. Do not add speculative portal capabilities here; Plan 4 performs the exhaustive inventory.

- [ ] **Step 4: Add typed lookup helpers**

`portal-admin-capabilities.mts` should load/represent only server-approved capabilities and expose:

```ts
export function portalAdminCapability(domain: PortalAdminDomain, action: string) { /* exact lookup */ }
export function portalAdminActionAllowed(domain: PortalAdminDomain, action: string) {
  const capability = portalAdminCapability(domain, action)
  return capability?.classification === 'relay-supported' || capability?.classification === 'relay-read-only'
}
```

The router must reject any unregistered domain/action before invoking a handler.

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
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `netlify/functions/attendance-assistant.mts`

- [ ] **Step 1: Write failing source/contract tests**

Require adapters to call existing assistants/services rather than query storage directly.

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, attendance] = await Promise.all([
  readFile('netlify/functions/_shared/portal-admin-schedule.mts', 'utf8'),
  readFile('netlify/functions/_shared/portal-admin-attendance.mts', 'utf8'),
])
assert.match(schedule, /scheduleAssistant/)
assert.match(attendance, /attendanceAssistant/)
assert.doesNotMatch(schedule, /database\.pool\.query|neon\(/)
assert.doesNotMatch(attendance, /database\.pool\.query|neon\(/)
```

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/portal-admin-adapter-source-test.mjs
```

- [ ] **Step 3: Implement adapters as internal Request wrappers**

Each adapter maps portal-admin action/input to the same request body expected by the existing assistant and uses `SCHEDULE_ASSISTANT_TOKEN` internally. Keep this adapter thin. Do not duplicate validation from `schedule-assistant.mts` or `attendance-assistant.mts`.

Example schedule adapter skeleton:

```ts
export function createSchedulePortalAdminHandler(context: Context): PortalAdminHandler {
  return async (operation) => {
    const token = String(Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || '').trim()
    const response = await scheduleAssistant(new Request('https://internal.invalid/api/schedule-assistant', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: operation.action, requestId: operation.itemId, ...operation.input }),
    }), context)
    const data = await response.json().catch(() => ({}))
    return mapAssistantResponse(operation, response.status, data)
  }
}
```

Map existing successful `published`/`duplicate`/management responses into common portal result statuses without exposing the request input.

- [ ] **Step 4: Keep legacy assistant contracts passing**

Run:

```bash
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node scripts/attendance-assistant-source-test.mjs
node --experimental-strip-types scripts/attendance-assistant-core-test.mjs
node scripts/portal-admin-adapter-source-test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/portal-admin-schedule.mts netlify/functions/_shared/portal-admin-attendance.mts scripts/portal-admin-adapter-source-test.mjs netlify/functions/schedule-assistant.mts netlify/functions/attendance-assistant.mts
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

Assert all of these invariants:

```js
assert.match(source, /verifyScheduleGithubOidc/)
assert.match(source, /decryptScheduleCommandEnvelopeRuntime/)
assert.match(source, /parsePortalAdminCommand/)
assert.match(source, /parseScheduleCommand/)
assert.match(source, /createPortalAdminRouter/)
assert.match(source, /if \(String\(command\.domain \|\| ''\)\)/)
assert.doesNotMatch(source, /database\.pool\.query|neon\(/)
```

Also assert the source index of `verifyScheduleGithubOidc` remains before decrypt, and decrypt remains before either parser.

- [ ] **Step 2: Run and confirm failure**

```bash
node scripts/portal-admin-oidc-source-test.mjs
```

- [ ] **Step 3: Implement dual-protocol routing**

After OIDC verification and envelope decryption:

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

Then fall through to the existing `parseScheduleCommand` branch unchanged for commands without `domain`.

Do not change public-key request handling.

- [ ] **Step 4: Make the relay runner accept generic aggregate counts without breaking legacy output**

Keep the current legacy summary line intact. Add a generic safe line only when `succeededCount` exists:

```js
const succeededCount = count(result?.succeededCount ?? 0)
if (result?.succeededCount !== undefined) {
  console.log(`Habun portal admin OIDC relay: succeeded=${succeededCount} rejected=${rejectedCount}`)
}
```

No names, actions with private inputs, or decrypted results may be logged.

- [ ] **Step 5: Run focused relay tests**

```bash
node scripts/portal-admin-oidc-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/attendance-oidc-trigger-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
node --experimental-strip-types scripts/portal-admin-command-test.mjs
```

Expected: all pass and existing schedule workflow test still proves the issue-comment transport did not change.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/schedule-oidc-trigger.mts scripts/run-schedule-oidc-relay.mjs scripts/portal-admin-oidc-source-test.mjs scripts/schedule-oidc-trigger-source-test.mjs scripts/attendance-oidc-trigger-source-test.mjs
git commit -m "feat: route portal admin commands through oidc relay"
```

---

## Task 6: Foundation regression verification

**Files:**
- Modify if needed: `package.json`

- [ ] **Step 1: Add a focused verification script**

Add:

```json
"verify:portal-admin-foundation": "node --experimental-strip-types scripts/portal-admin-command-test.mjs && node --experimental-strip-types scripts/portal-admin-router-test.mjs && node scripts/portal-admin-capability-registry-test.mjs && node scripts/portal-admin-adapter-source-test.mjs && node scripts/portal-admin-oidc-source-test.mjs && node scripts/schedule-oidc-workflow-source-test.mjs"
```

Do not yet add the final exhaustive `verify:portal-admin` gate; Plan 4 owns it.

- [ ] **Step 2: Run focused tests**

```bash
npm run verify:portal-admin-foundation
```

Expected: exit 0.

- [ ] **Step 3: Run the complete existing relay/assistant regression set**

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

Expected: all pass.

- [ ] **Step 4: Run full verification before handoff**

```bash
npm run verify
```

Expected: exit 0. If an unrelated pre-existing test fails, record exact command/output and do not claim complete success until it is resolved or explicitly scoped out.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "test: verify portal admin relay foundation"
```

## Foundation Done Criteria

- Existing PR #73 issue-comment relay behavior remains intact.
- Legacy schedule/attendance encrypted commands still work unchanged.
- New commands with `domain` are parsed, capability-checked, routed, and returned as encrypted detailed results.
- Trigger still verifies OIDC before decrypt and contains no direct data-store writes.
- Public GitHub-facing metadata remains aggregate/privacy-safe.
- New router is ready for the domain work in Plans 2–4.