# Full Portal Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the complete Habun employee portal feel faster while preserving all current permissions, business rules, location checks, schedule behavior, reports, and visual design.

**Architecture:** Extend the existing safe in-memory read-cache only for stable directory/configuration GETs, reduce unnecessary data transfer on Overview, and remove repeated expensive render work. Dynamic operational data stays fresh and uncached.

**Tech Stack:** React 19, JavaScript/ESM, Netlify Identity, Netlify Functions, esbuild, Node source tests, Playwright E2E.

## Global Constraints
- No role or permission changes.
- No attendance/location business-rule changes.
- No schedule-entry completed-value caching.
- No attendance completed-value caching.
- No PDF/Excel/report caching.
- No localStorage, IndexedDB, or offline persistence.
- No database migration.
- No visual redesign or copy changes.
- Stable cache is session-memory only and is cleared on logout/session change.
- Production only after verify + build + E2E pass.

---

### Task 1: Reduce render overhead across the app

**Files:**
- Modify: `scripts/apply-safe-performance-loading.mjs`
- Modify: `scripts/safe-performance-loading-source-test.mjs`

**Steps:**
- Add a module-level formatter cache used by `formatDate()` so identical `Intl.DateTimeFormat` options reuse one formatter.
- Move `now` state and the one-second timer from `AttendancePage` into `DigitalClock`, changing usage to `<DigitalClock />`.
- Add source assertions that Attendance no longer owns `setInterval` and that formatter reuse exists.

### Task 2: Reduce Overview payload

**Files:**
- Modify: `scripts/apply-safe-performance-loading.mjs`
- Modify: `scripts/safe-performance-loading-source-test.mjs`
- Modify: `tests/e2e/performance-loading.spec.mjs`

**Steps:**
- Compute `today` before Overview requests.
- Request `/api/schedule-v2?resource=entries&from=${today}&to=${today}` instead of an unbounded/default entries request.
- Keep attendance and registration requests concurrent.
- Browser test must assert Overview schedule request contains identical `from` and `to` dates.

### Task 3: Reuse stable data across Employees, Times, Reports, Worksites, Schedule editor, and Settings

**Files:**
- Modify: `scripts/apply-safe-performance-loading.mjs`
- Modify: `scripts/safe-performance-loading-source-test.mjs`
- Modify: `tests/e2e/performance-loading.spec.mjs`

**Interfaces:**
- `REGISTRATIONS_CACHE_KEY = '/api/registrations'`, TTL 15s.
- `OBJECTS_CACHE_KEY = '/api/schedule-v2?resource=objects'`, TTL 30s.
- `COMPANY_SETTINGS_CACHE_KEY = '/api/company-settings'`, TTL 60s.

**Steps:**
- Times employee directory: show registration snapshot immediately, then refresh through `refreshCachedJson`.
- Reports employee directory: same behavior.
- Worksites objects: show objects snapshot immediately, refresh, invalidate after object writes/deletes.
- Schedule management objects: use objects snapshot and refresh; schedule entries remain always fresh.
- Settings: show company-settings snapshot immediately, refresh, invalidate/prime after save.
- Login may prefetch registrations only as already implemented; do not add broad login prefetches.
- Add allowlisted cache-invalidation event support if existing injected UI needs it.

### Task 4: Prevent duplicate simultaneous GET work

**Files:**
- Modify: `frontend/src/read-cache.js`
- Modify: `scripts/read-cache-test.mjs`
- Modify: `scripts/apply-safe-performance-loading.mjs`

**Steps:**
- Add `dedupeInflightJson(key, loader)` that shares only an active Promise and stores no completed value.
- Use it for selected dynamic GETs that can be requested concurrently, especially attendance state and schedule entry loads.
- Ensure the Promise is removed in `finally` so later navigation always performs a fresh request.
- Unit test proves simultaneous calls dedupe and a later call runs loader again.

### Task 5: Schedule render efficiency

**Files:**
- Modify: `scripts/apply-safe-performance-loading.mjs`
- Modify: `scripts/safe-performance-loading-source-test.mjs`

**Steps:**
- Build a memoized `entriesByDate` map once per `visibleEntries` change.
- Management day cards read `entriesByDate.get(date) || []` instead of filtering all entries seven times per render.
- Preserve existing ordering and edit behavior.

### Task 6: Verification and release

**Steps:**
- Run source/unit verification through the repository's existing `npm run verify` GitHub Action.
- Run complete build.
- Run Playwright E2E including performance-loading tests.
- Review changed files for accidental role/business-rule changes.
- Merge only the verified branch.
- Use the existing single production marker flow for one Netlify production deploy.
