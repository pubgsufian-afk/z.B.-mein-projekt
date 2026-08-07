# Admin Time Editing Implementation Plan

**Goal:** Allow only `owner` and `admin` to directly edit completed work sessions on the **Zeiten** page, with server-side validation, recalculation, and audit history.

**Architecture:** Keep the existing attendance event model. The maintenance endpoint has one privileged `admin-time-edit` action that updates effective clock-in/clock-out timestamps, stores the effective pause as an `attendance_adjustments` row tied to the clock-out event, and writes before/after data to `attendance_audit_log`. History exposes the latest pause adjustment. To minimize regression risk in the large React portal, the UI is installed from `frontend/src/main.jsx` as a small isolated module (`frontend/src/admin-time-editing.js`) that activates only on the **Zeiten** page for `owner`/`admin`, derives event IDs from the authoritative attendance history, and reloads the existing view after saving.

**Constraints:**
- Direct editing only for `owner` and `admin`.
- `manager` and `employee` have no direct edit control.
- Beginning/end must be valid; end may not precede beginning.
- Pause is an integer >= 0 and may not exceed gross duration.
- Location records/status are never changed by direct time editing.
- Every change includes a reason and an audit record.
- If an unfiltered view contains more than one employee, the UI requires selecting one employee before direct editing to avoid ambiguous card/event matching.
- Production is not published until verification passes.

## Completed implementation

- [x] Added focused failing verification first (`scripts/admin-time-editing-test.mjs`).
- [x] Exposed latest `attendance_adjustments.pause_minutes` as `pauseMinutesAdjustment` in history.
- [x] Added server action `admin-time-edit` with owner/admin role guard.
- [x] Added validation for event pairing, time order, pause duration and neighboring-shift overlap.
- [x] Updated only attendance event timestamps/dates; location fields remain untouched.
- [x] Added pause adjustment persistence and `attendance_audit_log` before/after record.
- [x] Added isolated Admin UI module and wired it from `frontend/src/main.jsx`.
- [x] Added focused verification to `verify:v2` so normal project builds run it.
- [x] Reviewed branch diff for intended scope.

## Remaining before production

- [ ] Project/PR build passes focused verification.
- [ ] Existing attendance/access/unified portal verification passes.
- [ ] Build/deploy preview is healthy.
- [ ] Merge to `main` only after all checks are green.
- [ ] Verify Netlify production deployment is `ready`.
