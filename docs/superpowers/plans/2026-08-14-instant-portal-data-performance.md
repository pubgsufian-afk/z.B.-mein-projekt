# Instant Portal Data Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Habun employee portal feel immediate on repeat navigation, remove the false `0` flash in the Admin overview, and keep all dynamic/security-sensitive data fresh.

**Architecture:** Add a dedicated memory-only display snapshot layer separate from the existing stable-data read cache. Use it only to render the last trustworthy display state while fresh requests run. Apply the behavior through one idempotent build-time patch script so the existing performance patch pipeline remains intact, and verify it with source tests plus the existing full build/test suite.

**Tech Stack:** React 19, Vite/esbuild, Netlify Functions, Node.js 24, existing in-memory cache utilities, Playwright.

## Global Constraints

- Keep current design, roles, permissions, attendance rules, location checks, schedule semantics, reports, PDFs, Excel, and database contracts unchanged.
- Dynamic attendance/schedule/timesheet data must refresh from the server on page entry or input change.
- Display snapshots are memory-only and must never be used to authorize writes or privileged actions.
- No `localStorage`, `sessionStorage`, IndexedDB, service-worker cache, new API endpoint, or database migration.
- Daily-report CRUD and export requests remain uncached.
- One production deploy only after verification passes.

---

### Task 1: Add a dedicated display snapshot store

**Files:**
- Create: `frontend/src/display-snapshots.js`
- Create: `scripts/display-snapshots-test.mjs`

**Interfaces:**
- Produces: `peekDisplaySnapshot(key)`, `setDisplaySnapshot(key, value, ttlMs)`, `invalidateDisplaySnapshots(keyOrPredicate)`, `clearDisplaySnapshots()`.
- Consumers: Admin overview, schedule, and timesheet display loading.

- [ ] **Step 1: Write the failing snapshot-store test**

Create `scripts/display-snapshots-test.mjs` with assertions that prove snapshots are memory-only, expire, support predicate invalidation, and can be cleared completely:

```js
import assert from 'node:assert/strict'
import {
  clearDisplaySnapshots,
  invalidateDisplaySnapshots,
  peekDisplaySnapshot,
  setDisplaySnapshot,
} from '../frontend/src/display-snapshots.js'

clearDisplaySnapshots()
assert.equal(peekDisplaySnapshot('overview:today'), undefined)

setDisplaySnapshot('overview:today', { count: 3 }, 30000)
assert.deepEqual(peekDisplaySnapshot('overview:today'), { count: 3 })

setDisplaySnapshot('schedule:2026-08-10', { entries: [1] }, 30000)
setDisplaySnapshot('schedule:2026-08-17', { entries: [2] }, 30000)
invalidateDisplaySnapshots((key) => key.startsWith('schedule:'))
assert.equal(peekDisplaySnapshot('schedule:2026-08-10'), undefined)
assert.equal(peekDisplaySnapshot('schedule:2026-08-17'), undefined)

clearDisplaySnapshots()
assert.equal(peekDisplaySnapshot('overview:today'), undefined)

console.log('display-snapshots-test: PASS')
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/display-snapshots-test.mjs
```

Expected: FAIL because `frontend/src/display-snapshots.js` does not exist yet.

- [ ] **Step 3: Implement the minimal memory-only store**

Create `frontend/src/display-snapshots.js`:

```js
const values = new Map()

export function peekDisplaySnapshot(key) {
  const cacheKey = String(key)
  const entry = values.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    values.delete(cacheKey)
    return undefined
  }
  return entry.value
}

export function setDisplaySnapshot(key, value, ttlMs = 30000) {
  values.set(String(key), {
    value,
    expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0),
  })
  return value
}

export function invalidateDisplaySnapshots(keyOrPredicate) {
  if (typeof keyOrPredicate === 'function') {
    for (const key of [...values.keys()]) {
      if (keyOrPredicate(key)) values.delete(key)
    }
    return
  }
  values.delete(String(keyOrPredicate))
}

export function clearDisplaySnapshots() {
  values.clear()
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
node scripts/display-snapshots-test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/display-snapshots.js scripts/display-snapshots-test.mjs
git commit -m "perf: add memory-only display snapshots"
```

---

### Task 2: Remove the Admin overview zero flash and parallelize its data loads

**Files:**
- Create: `scripts/admin-overview-performance-test.mjs`
- Modify: `frontend/src/AdminOverview.jsx`
- Modify: `scripts/apply-instant-portal-data-performance.mjs` (created in Task 4, or apply the same exact final code there when Task 4 is reached)

**Interfaces:**
- Consumes: display snapshot functions from Task 1.
- Produces: cold-load placeholders, warm snapshot rendering, concurrent schedule/live refresh.

- [ ] **Step 1: Write the failing Admin overview source test**

Create `scripts/admin-overview-performance-test.mjs` asserting all of the following:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('frontend/src/AdminOverview.jsx', 'utf8')

assert.match(source, /from '\.\/display-snapshots\.js'/)
assert.match(source, /const \[scheduleLoaded, setScheduleLoaded\]/)
assert.match(source, /const \[liveLoaded, setLiveLoaded\]/)
assert.match(source, /Promise\.allSettled\(/)
assert.match(source, /peekDisplaySnapshot\(/)
assert.match(source, /setDisplaySnapshot\(/)
assert.match(source, /loading=\{!scheduleLoaded \|\| !liveLoaded\}/)
assert.doesNotMatch(source, /await apiJson\(`\/api\/schedule-v2[\s\S]*?await apiJson\(`\/api\/attendance\?resource=live/)

console.log('admin-overview-performance-test: PASS')
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/admin-overview-performance-test.mjs
```

Expected: FAIL because the overview still initializes empty arrays and loads schedule/live sequentially.

- [ ] **Step 3: Implement warm snapshots and explicit loading state**

Modify `frontend/src/AdminOverview.jsx` to:

1. Import:

```js
import { peekDisplaySnapshot, setDisplaySnapshot } from './display-snapshots.js'
```

2. Let `StatusRow` accept `loading` and render an ellipsis instead of a false zero:

```jsx
function StatusRow({ id, label, tone, entries, loading, open, onToggle }) {
  return (
    <div className={`deployment-status deployment-status-${tone}`}>
      <button type="button" className="deployment-status-button" aria-expanded={open} aria-controls={`deployment-group-${id}`} onClick={onToggle}>
        <span className="deployment-status-dot" aria-hidden="true" />
        <span className="deployment-status-label">{label} <b>· {loading ? '…' : entries.length}</b></span>
        <span className={`deployment-chevron ${open ? 'open' : ''}`}><Icon name="chevron" /></span>
      </button>
      {open && <div id={`deployment-group-${id}`} className="deployment-names">
        {loading ? <span className="deployment-empty">Daten werden geladen …</span> : entries.length ? entries.map((entry) => <span key={entry.key}>{entry.name}</span>) : <span className="deployment-empty">Keine Mitarbeiter</span>}
      </div>}
    </div>
  )
}
```

3. Initialize state from date-scoped snapshots when available and track loaded flags separately.

4. Start schedule and live requests together with `Promise.allSettled`.

5. On successful response, update React state and the matching display snapshot.

6. On failure, preserve any already-rendered snapshot and show the existing warning instead of clearing to empty arrays.

7. Pass `loading={!scheduleLoaded || !liveLoaded}` to all four `StatusRow` instances.

- [ ] **Step 4: Run the targeted test and existing Admin tests**

Run:

```bash
node scripts/admin-overview-performance-test.mjs
npm run verify:admin-overview
npm run verify:daily-reports
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/AdminOverview.jsx scripts/admin-overview-performance-test.mjs
git commit -m "perf: make admin overview data immediate"
```

---

### Task 3: Reuse warm schedule and timesheet display data safely

**Files:**
- Create: `scripts/instant-page-snapshots-test.mjs`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/TimesheetPage.jsx`

**Interfaces:**
- Consumes: display snapshot store from Task 1.
- Produces: immediate warm rendering for schedule and timesheet while still refreshing server data.

- [ ] **Step 1: Write the failing schedule/timesheet source test**

Create `scripts/instant-page-snapshots-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('frontend/src/App.jsx', 'utf8')
const timesheet = await readFile('frontend/src/TimesheetPage.jsx', 'utf8')

assert.match(app, /display-snapshots\.js/)
assert.match(app, /schedule-display:/)
assert.match(app, /peekDisplaySnapshot\(scheduleSnapshotKey/)
assert.match(app, /setDisplaySnapshot\(scheduleSnapshotKey/)
assert.match(app, /invalidateDisplaySnapshots\(\(key\) => key\.startsWith\('schedule-display:'\)\)/)
assert.match(timesheet, /display-snapshots\.js/)
assert.match(timesheet, /timesheet-actual:/)
assert.match(timesheet, /timesheet-planned:/)
assert.match(timesheet, /peekDisplaySnapshot\(actualSnapshotKey/)
assert.match(timesheet, /peekDisplaySnapshot\(plannedSnapshotKey/)
assert.match(timesheet, /invalidateDisplaySnapshots\(\(key\) => key\.startsWith\('timesheet-'\)\)/)

console.log('instant-page-snapshots-test: PASS')
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/instant-page-snapshots-test.mjs
```

Expected: FAIL because schedule/timesheet do not yet use display snapshots.

- [ ] **Step 3: Add schedule display snapshots**

In the performance-patched `SchedulePage` path in `frontend/src/App.jsx`:

1. Import `peekDisplaySnapshot`, `setDisplaySnapshot`, `invalidateDisplaySnapshots`, `clearDisplaySnapshots`.
2. Build a key from week and current role/user identity:

```js
const scheduleSnapshotKey = `schedule-display:${session.userId || session.id || 'session'}:${week}`
```

3. Before the fresh schedule request, synchronously apply any matching snapshot:

```js
const cachedEntries = peekDisplaySnapshot(scheduleSnapshotKey)
if (cachedEntries !== undefined) setEntries(cachedEntries)
```

4. After the fresh request succeeds:

```js
const freshEntries = shiftData.entries || []
setEntries(freshEntries)
setDisplaySnapshot(scheduleSnapshotKey, freshEntries, 30000)
```

5. After save/delete/repeat/publish/copy writes, invalidate schedule display snapshots before reloading:

```js
invalidateDisplaySnapshots((key) => key.startsWith('schedule-display:'))
```

- [ ] **Step 4: Add timesheet actual/planned display snapshots**

In `frontend/src/TimesheetPage.jsx`:

1. Import the display snapshot functions.
2. Build actual/planned keys from session identity, selected employee, and date range.
3. Apply a matching snapshot before each fresh request.
4. Store the newly built rows after a successful response.
5. Keep `loadActual()` and `loadPlanned()` fresh and concurrent through the existing `reload()`.
6. After manual create/edit writes, invalidate all `timesheet-` snapshots before refreshing actual rows.
7. Do not snapshot export blobs or write eligibility.

- [ ] **Step 5: Clear display snapshots on logout/session changes**

In `App` / session lifecycle, call:

```js
clearDisplaySnapshots()
```

when the identity user/session is cleared or replaced. Keep the existing `clearReadCache()` behavior intact.

- [ ] **Step 6: Run targeted and existing performance tests**

Run:

```bash
node scripts/instant-page-snapshots-test.mjs
node scripts/read-cache-test.mjs
node scripts/safe-performance-loading-source-test.mjs
node scripts/full-portal-performance-source-test.mjs
node scripts/timesheet-page-source-test.mjs
node scripts/timesheet-integration-test.mjs
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.jsx frontend/src/TimesheetPage.jsx scripts/instant-page-snapshots-test.mjs
git commit -m "perf: retain warm schedule and timesheet data"
```

---

### Task 4: Make the optimization idempotent in the build pipeline and verify production behavior

**Files:**
- Create: `scripts/apply-instant-portal-data-performance.mjs`
- Modify: `package.json`
- Modify: `tests/e2e/performance-loading.spec.mjs`
- Test: all new source tests plus existing full verification/build/E2E.

**Interfaces:**
- Consumes: existing `run-full-portal-performance-once.mjs` output.
- Produces: repeatable build-time application of the new performance layer on Netlify.

- [ ] **Step 1: Write/extend a failing pipeline contract test**

Add assertions to `scripts/instant-page-snapshots-test.mjs` that `package.json` runs the new patch after `run-full-portal-performance-once.mjs` and before its new source tests.

```js
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const unified = pkg.scripts['verify:unified']
assert.ok(unified.includes('run-full-portal-performance-once.mjs'))
assert.ok(unified.includes('apply-instant-portal-data-performance.mjs'))
assert.ok(unified.indexOf('run-full-portal-performance-once.mjs') < unified.indexOf('apply-instant-portal-data-performance.mjs'))
```

Run and confirm FAIL before changing `package.json`.

- [ ] **Step 2: Create the idempotent build patch**

Create `scripts/apply-instant-portal-data-performance.mjs` that:

- reads `frontend/src/App.jsx`, `frontend/src/AdminOverview.jsx`, and `frontend/src/TimesheetPage.jsx`;
- checks for stable done-markers before every replacement;
- applies exactly the final changes from Tasks 2 and 3 after the existing full-portal performance patch has run;
- writes only files that changed;
- logs either `Instant portal data performance applied` or `Instant portal data performance already applied`;
- throws on missing/ambiguous source markers instead of silently producing partial code.

- [ ] **Step 3: Add the patch and tests to the verification pipeline**

In `package.json`, place these directly after `run-full-portal-performance-once.mjs` in `verify:unified`:

```text
node scripts/apply-instant-portal-data-performance.mjs && node scripts/display-snapshots-test.mjs && node scripts/admin-overview-performance-test.mjs && node scripts/instant-page-snapshots-test.mjs
```

This guarantees Netlify builds the same optimized runtime every time.

- [ ] **Step 4: Add browser regression coverage**

Extend `tests/e2e/performance-loading.spec.mjs` with focused checks:

1. Cold Admin overview shows `…` before delayed mocked schedule/live responses and never shows a false `0` during that delay.
2. After real values render, navigate away and back; the prior values remain visible immediately while the second request is delayed.
3. Schedule warm revisit keeps its rows visible while a delayed refresh is in flight.
4. Timesheet warm revisit keeps rows visible while actual/planned refreshes are delayed.
5. A schedule/timesheet write invalidates the related snapshot so edited values are not resurrected.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: all PASS, no new warnings/errors.

- [ ] **Step 6: Commit the pipeline integration**

```bash
git add scripts/apply-instant-portal-data-performance.mjs package.json tests/e2e/performance-loading.spec.mjs scripts/display-snapshots-test.mjs scripts/admin-overview-performance-test.mjs scripts/instant-page-snapshots-test.mjs
git commit -m "perf: integrate instant portal data loading"
```

- [ ] **Step 7: Production release gate**

Only after the full verification output is green:

1. Compare the feature branch against `main`.
2. Merge the verified branch.
3. Confirm Netlify production deploy reaches `ready` with no build error.
4. Verify the deployed commit SHA matches the merged commit.
5. Check the production Admin overview behavior once more: no cold `0` flash, correct warm revisit, no role/attendance regression.
