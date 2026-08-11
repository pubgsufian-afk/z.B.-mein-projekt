# Full Portal Performance Design

## Goal
Speed up the entire Habun employee portal without changing visible design, permissions, attendance rules, schedule semantics, reports, PDFs, location checks, or database contracts.

## Scope
Optimize navigation and rendering across Overview, Attendance, Employees, Schedule, Timesheet/Times, Worksites, Reports, Settings, and remaining management pages.

## Architecture
Use three low-risk layers:

1. **Less work per render** — cache reusable `Intl.DateTimeFormat` instances, move the ticking clock state into the clock component so Attendance does not rerender every second, and pre-group schedule entries once instead of filtering repeatedly.
2. **Less data per request** — Overview asks the schedule API only for today's date instead of an unbounded/default range.
3. **Reuse only stable directory/config data** — extend the existing session-memory cache for registrations, worksite objects, and company settings. Cached values may render immediately but are always followed by a fresh server confirmation. Invalidate after writes and clear on logout/session change.

Dynamic security-sensitive data remains fresh: session, attendance state/live/history used for current actions, schedule entries, corrections, PDF/Excel/report generation, and all writes are never served from completed-value cache.

## Components
- `frontend/src/read-cache.js`: existing short-lived in-memory cache and in-flight deduplication.
- `scripts/apply-safe-performance-loading.mjs`: build-time patch that applies performance changes after existing product patches.
- `frontend/src/App.jsx`: runtime result of the patch.
- `scripts/safe-performance-loading-source-test.mjs`: source-contract tests.
- `tests/e2e/performance-loading.spec.mjs`: browser regressions for request reuse and early rendering.

## Data Flow
- Overview loads today's schedule and attendance concurrently.
- Employee/Times/Reports reuse `/api/registrations` snapshot while a fresh request confirms it.
- Worksites/Schedule editor reuse `/api/schedule-v2?resource=objects` snapshot while refreshing.
- Settings reuse `/api/company-settings` snapshot while refreshing.
- Writes invalidate only their related stable cache key.
- Logout/session changes clear all snapshots and in-flight requests.

## Error Handling
Fresh-request errors remain visible through existing notices. A previously cached stable directory/config snapshot may stay visible, but it is never used to authorize actions. Server endpoints continue to enforce all permissions.

## Performance Success Criteria
- Attendance page no longer rerenders its full subtree once per second solely for the clock.
- Overview schedule request contains `from=today&to=today`.
- Reopening Employees, Reports, Times, Worksites, or Settings can show stable data immediately and avoids duplicate concurrent GETs.
- Schedule entries and attendance state remain uncached completed values.
- Full verify, build, and Playwright E2E pass before merge.
- Exactly one production release after verification.

## Non-Goals
No visual redesign, no API/database migration, no offline persistence, no service worker changes, no new analytics, no background polling, and no change to business rules.