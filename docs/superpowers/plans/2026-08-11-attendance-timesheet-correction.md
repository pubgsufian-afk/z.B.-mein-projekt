# Attendance Timesheet Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add protected production attendance read/duplicate-diagnostic/session-edit/event-delete actions to the existing encrypted OIDC relay, then use them to correct the 2026-08-01..2026-08-12 timesheets and verify the final state.

**Architecture:** Reuse the existing schedule command envelope, GitHub OIDC workflow, RSA/AES decryption, and encrypted result artifact. Extend the command parser with attendance actions and route only those actions from `schedule-oidc-trigger.mts` to a new token-protected `attendance-assistant.mts`, which uses the existing production database connection helper and audit schema.

**Tech Stack:** Node.js 22, TypeScript `.mts`, Netlify Functions, `@neondatabase/serverless`, PostgreSQL, Node `crypto`, GitHub Actions OIDC, AES-256-GCM.

## Global Constraints

- No plaintext employee/attendance data in GitHub comments, logs, commits, or artifacts.
- No private-key retrieval/rotation.
- No direct writes to the empty Neon `main` branch.
- Read-before-write; every write uses exact IDs and an audit entry.
- Maximum attendance read range: 62 days.
- Maximum delete batch: 25 exact event IDs.
- No automatic deletion of ambiguous duplicates.
- One feature deploy only; later attendance corrections use the encrypted relay without code deploys.

---

### Task 1: Attendance command contract

**Files:**
- Modify: `netlify/functions/_shared/schedule-command-worker-core.mts`
- Test: `scripts/attendance-command-worker-test.mjs`

**Interfaces:**
- Produces actions: `list-attendance`, `find-attendance-duplicates`, `update-attendance-session`, `delete-attendance-events`.
- Adds command fields: `clockInEventId?: string`, `clockOutEventId?: string`, `eventIds?: string[]`, `clockInAt?: string`, `clockOutAt?: string`, `pauseMinutes?: number`, `reason?: string`.

- [ ] **Step 1: Write the failing parser test** covering valid read actions, 62-day range rejection, complete session edit requirements, nonnegative integer pause, delete batch limit, exact event IDs, reason, and 32-byte response key.
- [ ] **Step 2: Run** `node --experimental-strip-types scripts/attendance-command-worker-test.mjs` and confirm it fails because attendance actions are not recognized.
- [ ] **Step 3: Extend `ScheduleWorkerAction`, `ScheduleWorkerCommand`, validation, and parsed-field copying** with the four namespaced attendance actions while preserving all existing schedule behavior.
- [ ] **Step 4: Re-run the parser test** and confirm pass.
- [ ] **Step 5: Run** `node --experimental-strip-types scripts/schedule-command-worker-test.mjs` to confirm existing schedule parser coverage remains green.

### Task 2: Pure attendance duplicate/session core

**Files:**
- Create: `netlify/functions/_shared/attendance-assistant-core.mts`
- Test: `scripts/attendance-assistant-core-test.mjs`

**Interfaces:**
- `normalizeAttendanceName(value: unknown): string`
- `detectAttendanceDuplicates(events: AttendanceEventSnapshot[], employees: AttendanceEmployeeSnapshot[]): AttendanceDuplicateDiagnostics`
- `validateAttendanceSessionEdit(input): { clockInAt: string; clockOutAt: string; pauseMinutes: number }`

- [ ] **Step 1: Write failing core tests** for exact event duplicates, same normalized employee name on multiple user IDs, distinct-name isolation, valid session edits, reversed times, and pause-longer-than-gross rejection.
- [ ] **Step 2: Run** `node --experimental-strip-types scripts/attendance-assistant-core-test.mjs` and confirm module-not-found/failing behavior.
- [ ] **Step 3: Implement the minimal pure core** with deterministic sorting and no database/network access.
- [ ] **Step 4: Re-run the core test** and confirm pass.

### Task 3: Protected attendance assistant function

**Files:**
- Create: `netlify/functions/attendance-assistant.mts`
- Test: `scripts/attendance-assistant-source-test.mjs`

**Interfaces:**
- Bearer auth: existing `SCHEDULE_ASSISTANT_TOKEN`.
- Request body uses the parsed attendance action plus exact fields.
- `list-attendance` response: `{ action, from, to, events, adjustments, shifts, employees, counts }`.
- `find-attendance-duplicates` response: `{ action, from, to, diagnostics, counts }`.
- `update-attendance-session` response: `{ action, saved: true, clockInEventId, clockOutEventId }`.
- `delete-attendance-events` response: `{ action, deletedCount, eventIds }`.

- [ ] **Step 1: Write failing source-contract test** requiring token auth, `databaseConnectionString()`, bounded SELECTs, legal-hold check, audit-before-delete, audit/session edit writes, and no `getUser()` dependency.
- [ ] **Step 2: Run** `node scripts/attendance-assistant-source-test.mjs` and confirm failure because the function is absent.
- [ ] **Step 3: Implement read helpers** using production `databaseConnectionString()` and parameterized SQL for attendance events, latest adjustments, schedule shifts, and schedule employees.
- [ ] **Step 4: Implement `find-attendance-duplicates`** using the pure core.
- [ ] **Step 5: Implement `update-attendance-session`** with exact event pair validation, neighbor-overlap guard, latest pause adjustment insert, and `attendance_audit_log` before/after snapshot.
- [ ] **Step 6: Implement `delete-attendance-events`** with exact-ID fetch, missing-ID rejection, legal-hold rejection, per-event audit insertion, and exact delete.
- [ ] **Step 7: Re-run source-contract and core tests** and confirm pass.

### Task 4: OIDC relay routing and encrypted return

**Files:**
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Test: `scripts/attendance-oidc-trigger-source-test.mjs`

**Interfaces:**
- `isAttendanceAction(action)` identifies only the four attendance action names.
- Existing schedule actions still route to `scheduleAssistant` unchanged.
- Attendance actions route to `attendanceAssistant` with the same internal bearer token.
- Full detailed response is only placed in the existing `encryptedResult` when a response key is supplied.

- [ ] **Step 1: Write failing source test** requiring the attendance import, action router, action-specific request fields, and preservation of encrypted result generation.
- [ ] **Step 2: Run** `node scripts/attendance-oidc-trigger-source-test.mjs` and confirm failure.
- [ ] **Step 3: Modify trigger routing and request-body construction** without changing OIDC claim verification, envelope decryption, public key handling, or workflow permissions.
- [ ] **Step 4: Re-run the new source test and existing** `node scripts/schedule-oidc-trigger-source-test.mjs`.

### Task 5: Verification integration

**Files:**
- Modify: `package.json`

**Interfaces:**
- Add the three/four new attendance tests to `verify:unified` after existing schedule relay tests.

- [ ] **Step 1: Add test commands** to `verify:unified`.
- [ ] **Step 2: Run focused tests** for attendance command/core/assistant/trigger plus existing schedule command/trigger tests.
- [ ] **Step 3: Run `npm run verify`** and confirm zero failures.
- [ ] **Step 4: Run `npm run build:frontend`** and `npm run build` if dependencies/environment permit; otherwise rely on GitHub CI and report the exact limitation.

### Task 6: PR, CI, and production deploy

**Files:**
- No additional production files unless CI exposes a regression.

- [ ] **Step 1: Open one PR** from `fix/attendance-timesheets-2026-08` to `main` with the security/scope summary.
- [ ] **Step 2: Wait for GitHub verification and Netlify preview once**; do not trigger extra deploys.
- [ ] **Step 3: Fix only evidenced CI failures, rerun focused verification, and update the same PR.**
- [ ] **Step 4: Merge after verification.**
- [ ] **Step 5: Confirm the single production deploy is ready.**

### Task 7: Read, diagnose, correct, verify 2026-08-01..2026-08-12

**Files:**
- No code changes expected.

- [ ] **Step 1: Generate one Node.js RSA-OAEP-256 + AES-256-GCM encrypted `list-attendance` command** with a fresh 32-byte response key and send it through PR #73.
- [ ] **Step 2: Download the one-day encrypted artifact and decrypt locally.**
- [ ] **Step 3: Compare raw events, adjustments, shifts, employee IDs/names, and derived session signatures for 2026-08-01..2026-08-12.**
- [ ] **Step 4: Run encrypted `find-attendance-duplicates` and reconcile its diagnostics with the local comparison.**
- [ ] **Step 5: For each unambiguous wrong session, use `update-attendance-session`; for each confirmed duplicate/invalid event, use `delete-attendance-events` with exact IDs and a concise audit reason. Do not touch ambiguous rows.**
- [ ] **Step 6: Run a fresh encrypted `list-attendance` for the full range.**
- [ ] **Step 7: Verify duplicate people/events and wrong times/pauses are resolved, list any genuinely ambiguous items that remain, and only then report completion.**
