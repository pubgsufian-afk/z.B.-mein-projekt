# Instant Portal Data Performance Design

## Goal
Make the Habun employee portal feel substantially faster on iPhone and desktop by showing useful data immediately where safely possible, while keeping attendance, schedule, permissions, location checks, reports, and writes correct and fresh.

## User-visible problem
Several pages mount with empty React state, then fetch their data. This creates a visible flash of zero/empty content before the real values arrive. The current AdminOverview is a clear example: schedule and live attendance both start as empty arrays, so all status counters briefly show 0. The schedule request and live-attendance request are also executed sequentially. Similar remount-and-refetch behavior is visible on Schedule, Timesheet, Employees, Worksites, Reports, and Settings.

## Design principles
1. Never trade correctness for apparent speed.
2. Never use cached data to authorize an action.
3. Keep dynamic security-sensitive data fresh.
4. Reuse already-fetched display data during navigation when it is safe.
5. Show an explicit loading state instead of a false numerical zero when no trustworthy value exists yet.
6. Keep the current visual design, permissions, business rules, database contracts, and Netlify API routes unchanged.

## Architecture
Use four low-risk layers.

### 1. Shared in-memory page snapshots
Extend the existing `frontend/src/read-cache.js` pattern with short-lived display snapshots for safe read data. This remains memory-only: no localStorage, sessionStorage, IndexedDB, or service worker persistence.

Snapshots may be used to render immediately on remount, followed by a fresh background request. They must be cleared on logout/session change and invalidated after related writes.

### 2. Dynamic data uses stale-while-refresh display semantics only where safe
Schedule entries and attendance state/live are still refreshed from the server on every page entry. If a recent in-memory snapshot exists, it may remain visible while the fresh request is in flight. The snapshot is display-only and never decides whether clock-in, clock-out, pause, editing, publishing, or any privileged action is allowed.

For the AdminOverview, retain the last trustworthy schedule/live snapshot instead of resetting to empty arrays during navigation. On a cold first visit, counters show a loading placeholder until the first response arrives rather than false `0` values.

### 3. Parallelize independent requests
Requests that do not depend on each other should start together. The AdminOverview must load today’s schedule and live attendance concurrently with `Promise.allSettled` or equivalent independent concurrent requests so one slow endpoint does not block the other result.

Timesheet already loads actual and planned rows concurrently through its reload path; preserve that behavior. Schedule should continue to render its main entries before slower auxiliary directories when possible.

### 4. Preserve mounted page data across navigation when practical
Introduce a small page-state retention layer at `UnifiedPortal` level so revisiting a page can reuse its previous in-memory display state instead of starting from a blank component. Prefer targeted shared snapshots over keeping every page permanently mounted, because permanent mounting would keep hidden effects alive and increase memory usage.

## Data policy

### Safe to snapshot briefly for display
- registrations / employee directory
- worksite objects
- company settings
- today’s schedule display
- current schedule-range display
- timesheet display rows for the current selected range
- current AdminOverview live-status display

### Must always refresh on page entry or action
- session / identity / role
- attendance action eligibility
- live attendance
- current attendance state
- schedule entries
- timesheet actual attendance history
- corrections
- daily reports when opened
- report/PDF/Excel generation
- all writes

Dynamic data may reuse the most recent in-memory display snapshot during the refresh, but the application must not treat that snapshot as authoritative for writes or permissions.

## Loading behavior
- Cold load with no prior trustworthy data: show skeleton/ellipsis/loading label, not fake zeros or fake empty states.
- Warm revisit with a recent snapshot: show the existing data immediately and refresh in the background.
- If the refresh succeeds: replace the snapshot only when data changed.
- If the refresh fails: keep the prior display snapshot if one exists and show the existing error/notice. If no snapshot exists, show the normal error state.

## AdminOverview changes
- Add explicit `overviewLoaded` / per-resource loading state.
- Load today’s schedule and today’s live attendance concurrently.
- Prime/read short-lived in-memory snapshots keyed by date and resource.
- Do not initialize visible counters as trustworthy zero before the first response.
- Preserve the current status grouping and all labels/visual design.
- Do not cache daily-report CRUD operations.

## Schedule changes
- Keep current server refresh for entries on every week change/page entry.
- Reuse the last successful week snapshot for immediate rendering during a warm revisit.
- Continue to cache only stable object/employee directories as already designed.
- Invalidate the relevant week snapshot after save/delete/repeat/publish/copy operations.

## Timesheet changes
- Reuse the most recent actual/planned rows for the same selected range and employee as immediate display.
- Still refresh attendance history and schedule rows each time the selected inputs change or the page is revisited.
- Invalidate affected timesheet snapshots after manual create/edit operations.
- Keep export requests uncached.

## Employees, Worksites, Reports, Settings
- Continue/expand existing cached-then-fresh behavior for stable directories and company configuration.
- Avoid clearing already displayed data while refresh is running.
- Invalidate snapshots after every relevant write.

## Navigation and rendering
- Keep the existing visual structure.
- Use instant scroll (`behavior: 'auto'`) on page navigation rather than smooth scroll that makes the switch feel slower.
- Avoid unnecessary full-page rerenders from the digital clock; keep clock state isolated in the clock component.
- Avoid state assignments when incoming arrays/objects are structurally unchanged where this is simple and low-risk.

## Security and correctness constraints
- No changes to role access.
- No changes to employee/admin visibility rules.
- No changes to geolocation validation.
- No changes to attendance write validation.
- No changes to schedule publication rules.
- No persistent offline cache.
- No new public endpoints.
- No database migration.
- No caching of generated PDFs/Excel or report writes.

## Error handling
Independent requests should fail independently. For example, if live attendance fails but the schedule succeeds, today’s schedule must still render and only the live-status section should show its warning. A previously rendered snapshot may remain visible with a warning rather than flashing back to empty content.

## Testing
Add source/unit tests that prove:
- AdminOverview no longer displays cold-start zero counters before data is known.
- AdminOverview schedule/live requests are concurrent.
- warm snapshots render synchronously before refresh completion.
- dynamic snapshots are memory-only and never reused for authorization or writes.
- snapshots are invalidated after schedule and timesheet writes.
- logout/session change clears all snapshots.
- existing performance tests continue to pass.

Add browser regression coverage for:
- overview cold load: loading placeholder -> correct counts without 0 flash;
- overview warm revisit: previous correct counts visible immediately, then refresh;
- schedule warm revisit;
- timesheet warm revisit;
- writes followed by navigation do not show stale edited values;
- employee role/permissions remain unchanged.

## Success criteria
- No visible false `0` flash in the Einsatz-Zentrale on cold load.
- Revisiting Overview, Schedule, Timesheet, Employees, Worksites, Reports, or Settings feels immediate when a recent in-memory snapshot exists.
- Server refresh still occurs for dynamic schedule/attendance/timesheet data.
- No regression in attendance, location checks, role permissions, schedule editing/publishing, reports, PDFs, Excel, or daily reports.
- Full verification, build, and targeted Playwright performance regressions pass before production deploy.
- One verified production deploy only after tests pass.
