# Habun Attendance V2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved Habun employee portal attendance, location, scheduling, correction, and reporting work without changing or deploying the live `main` branch.

**Architecture:** Keep the existing Netlify Identity and portal shell. Add focused client modules and Netlify functions instead of replacing the current application. Reuse the approved Neon attendance schema after verification, enforce roles server-side, and keep every change on `work/attendance-v2-complete` until all acceptance tests pass and the user explicitly approves release.

**Tech Stack:** Static PWA, JavaScript ES modules, Netlify Functions, Netlify Identity, Netlify Blobs for existing compatibility, Neon PostgreSQL for attendance V2, Node test scripts.

## Global Constraints

- Do not deploy or merge to `main` without explicit user approval.
- Do not modify, redraw, recolor, crop, stretch, animate, or replace the existing Habun logo.
- Keep the current black background and existing portal colors.
- Capture location only on clock-in and clock-out; never in the background or during the shift.
- Allow clocking when outside 500 metres, location is unavailable, or the device is offline; mark the result visibly.
- Employees cannot start/end breaks or change configured break minutes.
- Employees can see only their own data and cannot download PDFs.
- Admin and manager can create reports; only admin can manage accounts, roles, global settings, and work-site coordinates.
- Preserve original attendance records after corrections and record every sensitive change in the audit trail.
- Keep exact location data for six months and attendance/business data for 24 months, except legal holds.
- No live release until all documented acceptance tests pass.

---

### Task 1: Baseline and Traceability

**Files:**
- Modify: `scripts/check.mjs`
- Create: `docs/attendance-v2/requirement-traceability.md`
- Create: `scripts/attendance-baseline-test.mjs`

**Interfaces:**
- Consumes: approved library specification dated 2026-08-05 and existing portal files.
- Produces: requirement IDs `ATT-001` through `ATT-090` and an executable baseline report.

- [ ] Write a failing baseline test that requires the new attendance files, no employee pause controls, clock-in/out location copy, and no signature fields in V2 reports.
- [ ] Run `node scripts/attendance-baseline-test.mjs` and confirm it fails because V2 files are missing.
- [ ] Add the requirement traceability document, mapping each approved requirement to a task and test.
- [ ] Extend `scripts/check.mjs` to include the new tests only after their files exist.
- [ ] Commit the baseline and traceability work.

### Task 2: Attendance Domain Rules and Idempotency

**Files:**
- Create: `netlify/functions/_shared/attendance-domain.mts`
- Create: `scripts/attendance-domain-test.mjs`

**Interfaces:**
- Produces:
  - `classifyLocation(distanceMeters, configured, available, radiusMeters)`
  - `validateAttendanceTransition(events, action)`
  - `calculateNetMinutes(clockInAt, clockOutAt, pauseMinutes)`
  - `buildIdempotencyKey(userId, clientEventId)`
  - `sanitizeAttendanceAuditPayload(payload)`

- [ ] Write failing tests for inside, outside, unavailable, and offline states.
- [ ] Write failing tests preventing clock-out before clock-in and duplicate action sequences.
- [ ] Write failing tests for automatic break deduction and invalid break lengths.
- [ ] Run the tests and confirm expected failures.
- [ ] Implement the minimum pure domain functions.
- [ ] Run tests until all domain tests pass.
- [ ] Commit domain rules.

### Task 3: Neon Attendance API

**Files:**
- Create: `netlify/functions/attendance.mts`
- Create: `netlify/functions/_shared/neon-attendance.mts`
- Create: `scripts/attendance-api-contract-test.mjs`
- Modify: `netlify.toml`

**Interfaces:**
- Endpoints under `/api/attendance`:
  - `GET ?resource=state`
  - `POST { action: "clock-in" | "clock-out", clientEventId, clientOccurredAt, location, scheduleId, objectId }`
  - `GET ?resource=live`
  - `GET ?resource=history&from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `POST { resource: "correction", ... }`
  - `POST { resource: "correction-decision", ... }`

- [ ] Write failing contract tests for authentication, employee self-scope, management scope, idempotency, location status, and correction permissions.
- [ ] Verify tests fail with the endpoint absent.
- [ ] Implement database access using environment-provided Neon connection details; never commit secrets.
- [ ] Implement server-side role checks using the current portal access records and Netlify Identity.
- [ ] Store client and server timestamps and reject mismatched replay hashes.
- [ ] Return the already stored response for exact duplicate client event IDs.
- [ ] Run contract tests and commit.

### Task 4: Reliable Employee Clock UI and Offline Queue

**Files:**
- Create: `public/attendance-core.js`
- Create: `public/attendance-v2.js`
- Create: `public/attendance-v2.css`
- Create: `scripts/attendance-client-test.mjs`
- Modify: `public/index.html`
- Modify: `netlify.toml`

**Interfaces:**
- Client storage keys:
  - `habun-attendance-state-v2`
  - `habun-attendance-queue-v2`
- Exports from `attendance-core.js`:
  - `createClientEventId()`
  - `enqueueAttendanceEvent(queue, event)`
  - `reduceAttendanceState(state, event)`
  - `nextAllowedAction(state)`
  - `sortPendingEvents(queue)`

- [ ] Write failing tests for stable client IDs, ordered offline replay, duplicate suppression, session-expiry retry, and restoring state before enabling buttons.
- [ ] Run tests and confirm failure.
- [ ] Implement pure queue/state helpers.
- [ ] Add employee UI that reuses the existing logo and colors, shows planned shift, work site, configured break, actual times, distance, and status.
- [ ] Request location only after an explicit clock-in/out tap.
- [ ] Allow unavailable/outside/offline booking and show the approved warning states.
- [ ] Remove or hide employee pause-start/pause-end controls in V2 and display automatic configured break minutes instead.
- [ ] Replay queued events after connectivity returns and refresh authoritative server state before re-enabling actions.
- [ ] Run client tests and commit.

### Task 5: Admin and Manager Live Attendance

**Files:**
- Create: `public/live-attendance.js`
- Create: `public/live-attendance.css`
- Create: `scripts/live-attendance-test.mjs`
- Modify: `public/index.html`

**Interfaces:**
- Consumes `/api/attendance?resource=live`.
- Displays filters for date, work site, employee, and status.

- [ ] Write failing tests for management-only installation, filter behaviour, red/green status rendering, offline markers, and exact stored-event map links.
- [ ] Implement the live list and detail panel without background tracking.
- [ ] Show clock-in and clock-out snapshots, accuracy, distance, scheduled shift, break minutes, warnings, and audit/correction status.
- [ ] Ensure employees cannot load the management payload even by manually calling the endpoint.
- [ ] Run tests and commit.

### Task 6: Schedule V2 Breaks, Drafts, Versions, and Conflict Assistance

**Files:**
- Create: `netlify/functions/schedule-v2.mts`
- Create: `public/schedule-v2.js`
- Create: `scripts/schedule-v2-test.mjs`
- Modify: `netlify/functions/work.mts`
- Modify: `public/schedule-multi-fix.js`

**Interfaces:**
- Schedule fields: `pauseMinutes`, `status`, `version`, `templateId`, `repeatGroupId`, `publishedAt`, `publishedBy`.
- Actions: create/update draft, copy previous week, repeat selected days, validate conflicts, publish version.

- [ ] Write failing tests for 30/45/60/custom breaks, automatic net-duration preview, conflict warnings, exact duplicate blocking, draft invisibility to employees, publish permissions, and version history.
- [ ] Implement V2 schedule persistence without deleting existing schedule data.
- [ ] Keep warnings advisory except invalid times and exact duplicates.
- [ ] Add previous-week copy, templates, selected-day repetition, and suitable-employee suggestions.
- [ ] Run tests and commit.

### Task 7: Corrections, Retention, and Audit Trail

**Files:**
- Create: `netlify/functions/attendance-maintenance.mts`
- Create: `public/attendance-corrections.js`
- Create: `scripts/attendance-corrections-test.mjs`
- Create: `scripts/attendance-retention-test.mjs`

**Interfaces:**
- Employee creates a reasoned correction request.
- Manager/admin approves, rejects, or requests clarification.
- Original record remains immutable; effective values are derived from approved decisions/adjustments.

- [ ] Write failing tests for self-only requests, required reasons, management decisions, immutable originals, location non-editability, legal holds, six-month coordinate deletion, and 24-month attendance deletion.
- [ ] Implement correction and decision UI/API.
- [ ] Implement maintenance actions with dry-run output and audit records that do not copy deleted coordinates.
- [ ] Run tests and commit.

### Task 8: V2 Reports and Server-Side Download Authorization

**Files:**
- Create: `netlify/functions/reports-v2.mts`
- Create: `public/reports-v2.js`
- Create: `scripts/reports-v2-test.mjs`
- Modify: `public/index.html`

**Interfaces:**
- Report types: employee detail and combined overview.
- Periods: one day, full month, arbitrary range.
- Output: one PDF per employee/period or one selected combined PDF.

- [ ] Write failing tests for employee denial, admin/manager authorization, planned-versus-actual columns, automatic break, daily/monthly/range totals, multi-page single-file months, and no-data behaviour.
- [ ] Write a failing scan that rejects personal number, private address, birth date, tax details, and signature fields.
- [ ] Implement V2 report generation using the unchanged original logo asset and approved company details.
- [ ] Ensure employees have web-only personal hours with no downloadable endpoint.
- [ ] Run tests and commit.

### Task 9: Full Verification Without Deployment

**Files:**
- Modify: `package.json`
- Modify: `scripts/check.mjs`
- Create: `docs/attendance-v2/verification-report.md`

**Interfaces:**
- `npm run check` must execute every V2 test and the existing portal tests.

- [ ] Run syntax checks for every new JS/MTS file.
- [ ] Run all existing and V2 automated tests.
- [ ] Verify role access for owner/admin/manager/employee.
- [ ] Verify clock-in/out inside, outside, unavailable, offline, duplicate tap, expired session, and restart recovery.
- [ ] Verify schedule draft/publish/version workflows.
- [ ] Generate and inspect day, month, multi-month, employee, and combined reports.
- [ ] Compare logo file/hash and existing color tokens to the current live version.
- [ ] Record every result in `verification-report.md`.
- [ ] Stop without merging or deploying. Present the verified branch to the user for approval.
