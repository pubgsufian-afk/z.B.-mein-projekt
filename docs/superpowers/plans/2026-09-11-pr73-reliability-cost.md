# PR #73 Reliability and Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #73 reliably resolve registered employees, prevent accidental guest identities, publish daily schedules in one bounded batch with production verification, and keep relay usage/cost low.

**Architecture:** Keep the encrypted PR #73 -> GitHub Actions OIDC -> Netlify admin router path. Move identity resolution, validation, mutation, and verification into one server-side schedule batch. Registered portal `userId` values are canonical; human names and aliases are only lookup inputs.

**Tech Stack:** TypeScript/Netlify Functions, Netlify Identity/Blobs, Neon-backed schedule repository, Node test scripts, GitHub Actions OIDC relay.

**Spec:** `docs/superpowers/specs/2026-09-11-pr73-reliability-cost-design.md`

## Global Constraints

- Registered portal user IDs are canonical. Display names are not identity keys.
- Normal schedule publishing must never silently create a provisional/guest identity.
- Ambiguous identity must stop the batch before writes.
- Normal daily schedule publishing should normally require one PR #73 workflow run.
- No per-employee or per-day relay loops when one bounded server-side batch can do the work.
- Production verification must occur before success is returned.
- Browser automation remains emergency fallback only.
- Existing encrypted transport, OIDC trust, audit trail, and security exclusions remain unchanged.

---

### Task 1: Canonical short-name resolution

**Files:**
- Modify: `netlify/functions/_shared/schedule-assistant-core.mts`
- Modify: `scripts/schedule-assistant-core-test.mjs`

**Interfaces:**
- Consumes: `AssistantDirectoryEmployee[]`
- Produces: `resolveAssistantEmployee(name, employees)` that can resolve a unique exact token anywhere in a registered full name and returns `ambiguous` when the token occurs in multiple active employees.

- [ ] **Step 1: Write failing regression tests**

Add cases equivalent to:

```js
assert.equal(
  resolveAssistantEmployee('Teno', [
    { userId: 'u1', fullName: 'Mohamed Teno', status: 'active' },
    { userId: 'u2', fullName: 'Omar Dirie', status: 'active' },
  ]).employee?.userId,
  'u1',
)

assert.equal(
  resolveAssistantEmployee('Ahmed', [
    { userId: 'u1', fullName: 'Mohamed Ahmed Warsame', status: 'active' },
    { userId: 'u2', fullName: 'Ahmed Zarzour', status: 'active' },
  ]).status,
  'ambiguous',
)
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --experimental-strip-types scripts/schedule-assistant-core-test.mjs`

Expected: the `Teno -> Mohamed Teno` assertion fails before implementation.

- [ ] **Step 3: Implement unique-token matching**

In `resolveAssistantEmployee`, after exact full-name matching and before fuzzy matching, compare the normalized single input token against every token of every active employee full name. Return one candidate only when exactly one registered employee matches; return `ambiguous` when more than one matches.

Do not prefer surname/first-name guesses over uniqueness. Do not use fuzzy token matching when exact token matching is ambiguous.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: resolve unique employee short names`

---

### Task 2: Remove normal guest fallback and make publish preflight all-or-nothing

**Files:**
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `scripts/schedule-assistant-source-test.mjs`
- Modify: `scripts/schedule-assistant-management-source-test.mjs` if needed

**Interfaces:**
- Consumes: `body.shifts[]`, current active portal directory, current provisional schedule identities.
- Produces: `publish-shifts` preflight result with resolved canonical employees before any write.

- [ ] **Step 1: Strengthen source tests first**

Require the canonical source to contain a preflight phase that:

```js
assert.match(publishHandler, /resolveAssistantSchedulePerson\(/)
assert.match(publishHandler, /preflightFailed/)
assert.match(publishHandler, /resolvedEmployees/)
assert.doesNotMatch(publishSource, /allowUnregistered/)
assert.doesNotMatch(source, /allowUnregistered && resolved\.status === 'not_found'/)
```

Also assert that ordinary `publish-shifts` does not create `provisionalEmployeeUserId` directly.

- [ ] **Step 2: Run source tests and confirm current canonical source fails**

Run: `node scripts/schedule-assistant-source-test.mjs`

Expected: FAIL because the checked-in source still allows `publishOne(... allowUnregistered)`.

- [ ] **Step 3: Move resolution into preflight**

For every input shift:

1. validate the shift shape,
2. resolve the employee using the registered directory first,
3. allow an existing provisional identity only when it is explicitly supplied/approved through the exceptional path,
4. collect all hard failures,
5. if any hard failure exists, return `preflightFailed: true` and write zero shifts,
6. otherwise pass `{ userId, fullName }` into `publishOne`.

Change `publishOne` signature to receive the already-resolved employee and remove normal guest creation logic from that function.

- [ ] **Step 4: Run focused source/core tests**

Run:

```bash
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: preflight schedule identities before publish`

---

### Task 3: Add in-run production verification and idempotent retry behavior

**Files:**
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts` only if a targeted lookup helper is missing
- Modify/Create: focused source/regression test under `scripts/`

**Interfaces:**
- Produces per-item verification fields and a batch-level verified status.
- Reuses `requestId`/`sourceRef` to prevent a retry from producing another shift.

- [ ] **Step 1: Add failing tests**

Test that a repeated request with the same `requestId` and item index is classified as already satisfied rather than inserted again, and that a mutation result cannot be `published`/`success` if the post-write row cannot be read back with matching canonical fields.

- [ ] **Step 2: Run the focused test and confirm failure**

Expected: FAIL before implementation.

- [ ] **Step 3: Implement verification inside the same request**

After `upsertScheduleShift`, fetch the saved shift and compare:

```ts
employeeUserId
employeeName
date
start
end
pauseMinutes
objectId
location
workArea
status
sourceRef
```

Return `verification_failed` when any field differs or the row is missing.

Before inserting, check for an existing row with the same stable `sourceRef = assistant:${requestId}:${index}` and return `duplicate/already_satisfied` when it already represents the requested state.

- [ ] **Step 4: Run focused schedule tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: verify schedule writes in relay run`

---

### Task 4: Canonical work areas and pause policy without extra relay calls

**Files:**
- Create: `netlify/functions/_shared/schedule-work-policy.mts`
- Modify: `netlify/functions/schedule-assistant.mts`
- Create/Modify: `scripts/schedule-work-policy-test.mjs`

**Interfaces:**
- Produces:

```ts
resolveScheduleWorkArea(input: unknown): { key: string; label: string } | null
resolveSchedulePause(input: { workAreaKey: string; start: string; end: string; employeeUserId: string; explicitPause?: unknown }): number
```

- [ ] **Step 1: Write failing policy tests**

Cover aliases such as `Brandwach -> Brandwache`, `GMP Rundgang -> GMP Rundgang`, and configured default pauses. Preserve explicit valid pauses. Keep employee-specific exceptions in configuration keyed by canonical user ID, not by conversational name.

- [ ] **Step 2: Run test and confirm failure**

Run: `node --experimental-strip-types scripts/schedule-work-policy-test.mjs`

- [ ] **Step 3: Implement the policy module**

Normalize recurring area labels to stable keys while saving the human-readable canonical label. Apply pause policy during the same publish preflight; do not add a separate PR #73 request.

- [ ] **Step 4: Run policy + schedule tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: canonicalize schedule work areas and pauses`

---

### Task 5: Add explicit alias administration and safe provisional reconciliation

**Files:**
- Create: `netlify/functions/_shared/employee-alias-service.mts`
- Modify: `netlify/functions/_shared/schedule-assistant-core.mts`
- Modify: `netlify/functions/_shared/portal-admin-employees.mts`
- Modify: `ops/portal-admin-capabilities-extra.json`
- Modify: `netlify/functions/_shared/portal-admin-history.mts` only as needed to reuse existing rebind service
- Add focused tests under `scripts/`

**Interfaces:**
- New employee relay actions: `list-aliases`, `save-alias`, `delete-alias`.
- Aliases map normalized alias -> canonical registered `userId`.
- Existing history rebind remains the only path that mutates old guest/provisional records.

- [ ] **Step 1: Write failing tests**

Test that an alias can resolve `Teno` to the canonical ID, but an exact canonical full-name match always wins. Test that conflicting aliases are rejected.

- [ ] **Step 2: Implement alias service with strong-consistency storage**

Store only alias, target user ID, created/updated metadata. On use, re-read the current registered employee by user ID so stale display names do not become identity keys.

- [ ] **Step 3: Expose typed relay actions**

Register them in the capability registry and route through the employee admin handler.

- [ ] **Step 4: Keep reconciliation explicit**

Use the existing `inspect-employee-history` + `rebind-employee-history` service for historical guest records. Do not auto-rebind ambiguous names.

- [ ] **Step 5: Run alias/history/capability tests**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add employee aliases for relay resolution`

---

### Task 6: Add compact portal health inspection

**Files:**
- Create: `netlify/functions/_shared/portal-admin-health.mts`
- Modify: portal admin router registration file that constructs handlers
- Modify: `ops/portal-admin-capabilities-extra.json`
- Add: `scripts/portal-admin-health-test.mjs`

**Interfaces:**
- New read-only relay action: `portal-health`.
- Input: optional bounded `from`/`to` and optional problem categories.
- Output: compact counts + problem summaries, not full portal dumps.

- [ ] **Step 1: Write failing health tests**

Seed/fixture cases for:

```text
registered employee count
guest/provisional schedule IDs
unknown employee IDs
exact/time duplicate counts
invalid worksite references
noncanonical work areas
attendance identity mismatch count
```

- [ ] **Step 2: Implement bounded aggregate checks**

Reuse existing directory, schedule and attendance repository/service functions. Do not introduce per-employee relay calls. Enforce date-range limits where historical scans are required.

- [ ] **Step 3: Register the read-only capability**

- [ ] **Step 4: Run health + capability-registry tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add compact PR73 portal health check`

---

### Task 7: Critical build/source cleanup and full cost-path verification

**Files:**
- Modify: `package.json`
- Retire/modify only patch scripts that rewrite the schedule/relay files changed by Tasks 1-6
- Modify: `scripts/verify-unified-schedule-finalizers-test.mjs` or add an equivalent canonical-source guard

**Interfaces:**
- Canonical repository source must already contain the implementation that tests/build deploy.

- [ ] **Step 1: Identify patch scripts that rewrite touched canonical files**

At minimum inspect scripts matching schedule assistant, publish-user-id, portal-admin relay, and work-policy behavior.

- [ ] **Step 2: Add a failing guard test**

The guard should fail if running the relevant build preparation scripts changes the canonical critical files after checkout.

- [ ] **Step 3: Fold required behavior into canonical source and retire obsolete one-time rewrites**

Do not remove unrelated migration scripts.

- [ ] **Step 4: Run full relevant verification**

Run:

```bash
npm run verify:portal-admin-foundation
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
npm run verify:unified
```

Expected: PASS.

- [ ] **Step 5: Verify cost-path properties**

Add/execute a fixture with 100+ registered employees and a multi-shift daily batch. Assert directory loading occurs once inside the server-side operation and no per-employee relay loop is introduced. Assert a successful normal publish returns canonical IDs and verification data in one request.

- [ ] **Step 6: Commit**

Commit message: `chore: make PR73 critical source canonical`

---

## Final Verification

- [ ] Run all focused schedule/relay tests.
- [ ] Run capability registry tests.
- [ ] Run `npm run verify:unified`.
- [ ] Inspect the branch diff for accidental secret/logging exposure.
- [ ] Confirm PR #73 itself remains open and is not merged.
- [ ] Confirm normal publish cannot create a guest without an explicit exceptional operation.
- [ ] Confirm `Teno` uniquely resolves to `Mohamed Teno` when that is the only registered token match.
- [ ] Confirm ambiguous short names return candidates and write nothing.
- [ ] Confirm normal daily batch performs resolution + preflight + writes + verification in one server-side relay execution.
