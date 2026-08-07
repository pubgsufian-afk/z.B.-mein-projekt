# Admin Time Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow only `owner` and `admin` to directly edit completed work sessions on the **Zeiten** page, with server-side validation, recalculation, and audit history.

**Architecture:** Keep the existing attendance event model. The maintenance endpoint gains one privileged `admin-time-edit` action that updates the effective clock-in/clock-out event timestamps, stores the effective pause as an `attendance_adjustments` row tied to the session's clock-out event, and writes a full before/after record to `attendance_audit_log`. History queries expose the latest pause adjustment, and the React **Zeiten** page builds sessions with event IDs so `owner`/`admin` can open an inline editor and reload the authoritative history after saving.

**Tech Stack:** React/Vite frontend, Netlify Functions, Netlify Identity roles, Neon Postgres, Node `.mjs` verification scripts.

## Global Constraints

- Direct edit permission is only for `owner` and `admin`.
- `manager` remains read-only for direct time editing.
- `employee` receives no direct edit access.
- Start and end must be valid timestamps; end must not precede start.
- Pause must be an integer >= 0 and must not exceed gross duration.
- Location snapshots/status are not changed by this feature.
- Every direct edit must create an audit record containing before/after values, actor, role, time, and reason.
- Production is not published until verification succeeds.

---

### Task 1: Effective session data and pause adjustment

**Files:**
- Modify: `netlify/functions/_shared/neon-attendance.mts`
- Test: `scripts/admin-time-editing-test.mjs`

**Interfaces:**
- Produces history event field `pauseMinutesAdjustment: number | null` from the latest `attendance_adjustments` row for the event.
- Existing consumers keep all current event fields unchanged.

- [ ] **Step 1: Write the failing test**

Create `scripts/admin-time-editing-test.mjs` with source-level assertions that the history query joins the latest adjustment and `mapAttendanceEventRow()` exposes `pauseMinutesAdjustment`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: FAIL because `pauseMinutesAdjustment` and adjustment join do not yet exist.

- [ ] **Step 3: Write minimal implementation**

Extend the attendance history select so a lateral subquery reads the newest `attendance_adjustments` row for each event and selects `pause_minutes AS pause_minutes_adjustment`. Map that to `pauseMinutesAdjustment` without altering location data.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: PASS for effective pause exposure.

- [ ] **Step 5: Commit**

Commit message: `feat: expose attendance pause adjustments`

---

### Task 2: Server-side owner/admin direct edit action

**Files:**
- Modify: `netlify/functions/attendance-maintenance.mts`
- Test: `scripts/admin-time-editing-test.mjs`

**Interfaces:**
- Consumes POST `/api/attendance-maintenance` body:
  `{ action: 'admin-time-edit', clockInEventId, clockOutEventId, clockInAt, clockOutAt, pauseMinutes, reason }`
- Produces `{ saved: true, clockInEventId, clockOutEventId }` on success.
- Returns HTTP 403 for roles other than `owner`/`admin`.

- [ ] **Step 1: Extend the failing test**

Assert the maintenance source contains an `ADMINISTRATION` role guard, the `admin-time-edit` action, gross/pause validation, updates for both event timestamps, an `attendance_adjustments` insert, and an `attendance_audit_log` insert using action `admin-time-edit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: FAIL because the direct edit action is absent.

- [ ] **Step 3: Implement the endpoint action**

Load both event rows by IDs, require same `user_id`, require actions `clock-in` and `clock-out`, validate new times and pause, recompute each event's Berlin `event_date`, update only event timestamps/dates, insert the latest pause adjustment for the clock-out event, and write one audit row with `{clockInAt, clockOutAt, pauseMinutes}` before/after values. Do not update `attendance_locations`, `object_id`, `schedule_id`, or `location_status`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: PASS for role guard, validation, persistence, and audit markers.

- [ ] **Step 5: Commit**

Commit message: `feat: allow admins to edit work sessions`

---

### Task 3: Owner/admin editing UI on Zeiten page

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css` (or the active stylesheet containing `.times-list` rules)
- Test: `scripts/admin-time-editing-test.mjs`

**Interfaces:**
- `buildSessions()` must retain `clockInEventId` and `clockOutEventId` and apply `pauseMinutesAdjustment` from the clock-out event as the effective pause.
- `TimesPage` shows **Bearbeiten** only when `ADMINISTRATION.has(session.role)`.

- [ ] **Step 1: Extend the failing test**

Assert `buildSessions()` keeps both event IDs, applies the latest pause override, and the UI role check uses `ADMINISTRATION` rather than `MANAGEMENT`. Assert the save request sends `action: 'admin-time-edit'` to `/api/attendance-maintenance`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: FAIL because session IDs/editor/save request are absent.

- [ ] **Step 3: Implement the editor**

Add `editingSession` state to `TimesPage`. For each completed session, render **Bearbeiten** only for `owner`/`admin`. The editor contains datetime-local fields for beginning/end, integer pause minutes, and a required change reason. On save, call `/api/attendance-maintenance`, close the editor only after success, call `load()`, and show a success notice. Keep the existing black/gold visual system and mobile layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: PASS for UI permission and request wiring.

- [ ] **Step 5: Commit**

Commit message: `feat: add admin time editor`

---

### Task 4: Regression verification before production

**Files:**
- Test: `scripts/admin-time-editing-test.mjs`
- Verify existing: `scripts/attendance-v2-verify.mjs`, `scripts/employee-access-policy-test.mjs`, `scripts/unified-portal-test.mjs`

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Run focused verification**

Run: `node scripts/admin-time-editing-test.mjs`
Expected: PASS.

- [ ] **Step 2: Run attendance/access regressions**

Run: `node scripts/attendance-v2-verify.mjs`
Run: `node scripts/employee-access-policy-test.mjs`
Expected: PASS.

- [ ] **Step 3: Run unified portal regression**

Run: `node scripts/unified-portal-test.mjs`
Expected: PASS.

- [ ] **Step 4: Review branch diff**

Confirm no employee/manager direct edit path exists, no location fields are updated, and only the intended attendance/frontend files changed.

- [ ] **Step 5: Publish only after all checks pass**

Merge the feature branch to `main`, allow Netlify production deployment, then verify the production deploy is `ready` and the **Zeiten** page still loads normally.
