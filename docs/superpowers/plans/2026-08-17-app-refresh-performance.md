# App Refresh and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installed Habun web app refresh the currently visible data automatically when it returns from the background or receives a relevant push, while preserving the existing fast cached display and avoiding full-page reloads.

**Architecture:** Add one small browser-level refresh event bus and one React subscription hook. `main.jsx` installs lifecycle triggers once; active pages subscribe with their existing `load`/`reload` functions. The service worker tells open clients when a push message represents new portal data. Existing `no-store`, in-flight deduplication and memory-only cache behavior remain intact.

**Tech Stack:** React, Vite, Netlify PWA/service worker, Playwright, Node source-contract tests.

## Global Constraints

- Do not change login duration or authentication behavior.
- Do not persist schedule, attendance or session data in `localStorage`, `sessionStorage` or IndexedDB.
- Keep API reads `cache: 'no-store'` for dynamic attendance and schedule data.
- Existing visible data must remain on screen while a background refresh is running.
- A failed background refresh must not replace valid visible data with empty arrays or zero values.
- Do not force `window.location.reload()` when returning to the app.
- Avoid overlapping duplicate refreshes.

---

### Task 1: Browser refresh event bus

**Files:**
- Create: `frontend/src/data-refresh.js`
- Create: `scripts/data-refresh-source-test.mjs`
- Modify: `frontend/src/main.jsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `installDataRefreshTriggers({ intervalMs?: number }): () => void`
- Produces: `requestDataRefresh(reason: string): void`
- Produces: `subscribeDataRefresh(listener: (detail: { reason: string; at: number }) => void): () => void`

- [ ] **Step 1: Write the failing source-contract test**

Create `scripts/data-refresh-source-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [refresh, main] = await Promise.all([
  readFile('frontend/src/data-refresh.js', 'utf8'),
  readFile('frontend/src/main.jsx', 'utf8'),
])

assert.match(refresh, /habun:data-refresh/)
assert.match(refresh, /visibilitychange/)
assert.match(refresh, /pageshow/)
assert.match(refresh, /focus/)
assert.match(refresh, /serviceWorker/)
assert.match(refresh, /PORTAL_DATA_CHANGED/)
assert.doesNotMatch(refresh, /localStorage|sessionStorage|indexedDB|location\.reload/)
assert.match(main, /installDataRefreshTriggers\(/)
console.log('data refresh source contract: ok')
```

Add `node scripts/data-refresh-source-test.mjs` to `verify:unified` immediately after the existing performance source tests.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node scripts/data-refresh-source-test.mjs
```

Expected: failure because `frontend/src/data-refresh.js` does not exist.

- [ ] **Step 3: Implement the event bus**

Create `frontend/src/data-refresh.js`:

```js
const REFRESH_EVENT = 'habun:data-refresh'
let installed = false
let cleanup = () => {}

export function requestDataRefresh(reason = 'manual') {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT, {
    detail: { reason: String(reason || 'manual'), at: Date.now() },
  }))
}

export function subscribeDataRefresh(listener) {
  const handler = (event) => listener(event.detail || { reason: 'unknown', at: Date.now() })
  window.addEventListener(REFRESH_EVENT, handler)
  return () => window.removeEventListener(REFRESH_EVENT, handler)
}

export function installDataRefreshTriggers({ intervalMs = 60000 } = {}) {
  if (installed) return cleanup
  installed = true
  let lastAutomaticAt = 0

  const emit = (reason, minGapMs = 1500) => {
    const now = Date.now()
    if (now - lastAutomaticAt < minGapMs) return
    lastAutomaticAt = now
    requestDataRefresh(reason)
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') emit('visible')
  }
  const onPageShow = () => emit('pageshow')
  const onFocus = () => {
    if (document.visibilityState !== 'hidden') emit('focus')
  }
  const onServiceWorkerMessage = (event) => {
    if (event.data?.type === 'PORTAL_DATA_CHANGED') emit('push', 0)
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('focus', onFocus)
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage)

  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') emit('interval', intervalMs - 1000)
  }, intervalMs)

  cleanup = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('focus', onFocus)
    navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage)
    window.clearInterval(timer)
    installed = false
  }
  return cleanup
}
```

In `frontend/src/main.jsx` import and install it exactly once before rendering:

```js
import { installDataRefreshTriggers } from './data-refresh.js'

installDataRefreshTriggers({ intervalMs: 60000 })
```

- [ ] **Step 4: Run the source test**

```bash
node scripts/data-refresh-source-test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data-refresh.js frontend/src/main.jsx scripts/data-refresh-source-test.mjs package.json
git commit -m "feat: add portal data refresh lifecycle"
```

---

### Task 2: React refresh subscription without clearing visible data

**Files:**
- Create: `frontend/src/use-data-refresh.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/TimesheetPage.jsx`
- Modify: `frontend/src/TimesheetMonthlyPage.jsx`
- Modify: `frontend/src/AdminOverview.jsx`
- Modify: `scripts/data-refresh-source-test.mjs`

**Interfaces:**
- Consumes: `subscribeDataRefresh()` from Task 1.
- Produces: `useDataRefresh(refreshFn, { enabled?: boolean }): void`.

- [ ] **Step 1: Extend the failing contract test**

Add assertions:

```js
const hook = await readFile('frontend/src/use-data-refresh.js', 'utf8')
assert.match(hook, /subscribeDataRefresh/)
assert.match(hook, /runningRef/)
assert.match(hook, /refreshRef/)
assert.doesNotMatch(hook, /setInterval|location\.reload/)
```

Add assertions that `App.jsx`, `TimesheetPage.jsx`, `TimesheetMonthlyPage.jsx` and `AdminOverview.jsx` import `useDataRefresh`.

Run and expect RED because the hook does not exist.

- [ ] **Step 2: Implement the hook**

Create `frontend/src/use-data-refresh.js`:

```js
import { useEffect, useRef } from 'react'
import { subscribeDataRefresh } from './data-refresh.js'

export function useDataRefresh(refreshFn, { enabled = true } = {}) {
  const refreshRef = useRef(refreshFn)
  const runningRef = useRef(false)

  useEffect(() => { refreshRef.current = refreshFn }, [refreshFn])

  useEffect(() => {
    if (!enabled) return undefined
    return subscribeDataRefresh(async () => {
      if (runningRef.current) return
      runningRef.current = true
      try { await refreshRef.current?.() } catch {} finally { runningRef.current = false }
    })
  }, [enabled])
}
```

The hook deliberately does not own loading state and therefore cannot blank an existing page.

- [ ] **Step 3: Wire the current active portal views**

In `App.jsx`, convert the `OverviewPage` initial inline effect into a stable `load` callback, then use both initial load and background refresh:

```js
const load = useCallback(async () => {
  const today = berlinDateKey()
  const schedulePath = `/api/schedule-v2?resource=entries&from=${today}&to=${today}`
  const calls = [
    dedupeInflightJson(schedulePath, () => apiJson(schedulePath)),
    dedupeInflightJson('/api/attendance?resource=state', () => apiJson('/api/attendance?resource=state')),
  ]
  if (MANAGEMENT.has(session.role)) calls.push(refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson('/api/registrations'), { ttlMs: REGISTRATIONS_CACHE_TTL_MS }))
  const [scheduleData, attendanceData, registrationData] = await Promise.all(calls)
  setSchedule(scheduleData.entries || [])
  setAttendance(attendanceData)
  if (registrationData) setRequests(registrationData.requests || [])
}, [session.role])

useEffect(() => { void load() }, [load])
useDataRefresh(load)
```

For existing callback-based pages, keep their current initial `useEffect` and add only the subscription:

```js
useDataRefresh(load)
```

Apply this to `AttendancePage`, `EmployeesPage`, `SchedulePage`, `WorksitesPage` and other `App.jsx` views that already expose a safe read-only `load` callback. Do not attach the hook to PDF/export-only actions or editor save handlers.

In `TimesheetPage.jsx`:

```js
useDataRefresh(reload)
```

In `TimesheetMonthlyPage.jsx`:

```js
useDataRefresh(loadTimesheet)
```

In `AdminOverview.jsx`, subscribe the existing dashboard loader rather than constructing a second API path.

- [ ] **Step 4: Run source and existing performance tests**

```bash
node scripts/data-refresh-source-test.mjs
node scripts/safe-performance-loading-source-test.mjs
node scripts/full-portal-performance-source-test.mjs
```

Expected: all PASS; no new persistent browser cache is introduced.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/use-data-refresh.js frontend/src/App.jsx frontend/src/TimesheetPage.jsx frontend/src/TimesheetMonthlyPage.jsx frontend/src/AdminOverview.jsx scripts/data-refresh-source-test.mjs
git commit -m "feat: refresh active portal views on resume"
```

---

### Task 3: Push tells an already-open app that data changed

**Files:**
- Modify: `frontend/public/push-sw.js`
- Modify: `scripts/data-refresh-source-test.mjs`

**Interfaces:**
- Produces service-worker message `{ type: 'PORTAL_DATA_CHANGED' }` to same-origin window clients after a push payload has been resolved.

- [ ] **Step 1: Add a RED assertion**

```js
const sw = await readFile('frontend/public/push-sw.js', 'utf8')
assert.match(sw, /PORTAL_DATA_CHANGED/)
assert.match(sw, /clients\.matchAll/)
assert.match(sw, /client\.postMessage/)
```

Run and expect failure.

- [ ] **Step 2: Implement client invalidation after push lookup**

Inside the push handler, after the message has been fetched and before/after `showNotification`, add:

```js
const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
for (const client of windows) {
  if (new URL(client.url).origin !== self.location.origin) continue
  client.postMessage({ type: 'PORTAL_DATA_CHANGED' })
}
```

Do not navigate or reload an open client here. Notification-click behavior remains unchanged.

- [ ] **Step 3: Run push and refresh contracts**

```bash
node scripts/data-refresh-source-test.mjs
node scripts/push-auto-test-source-test.mjs
node scripts/ios-push-registration-source-test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/push-sw.js scripts/data-refresh-source-test.mjs
git commit -m "feat: refresh open portal after push updates"
```

---

### Task 4: Browser regression coverage for iPhone-style resume

**Files:**
- Modify: `tests/e2e/performance-loading.spec.mjs`

**Interfaces:**
- Verifies the current visible page replaces stale server data after a lifecycle refresh without navigation or login.

- [ ] **Step 1: Add a failing Dienstplan resume test**

Add a Playwright test that returns version A on the first schedule request and version B after a synthetic `pageshow` event:

```js
test('visible Dienstplan refreshes after app resume without reopening', async ({ page }) => {
  let version = 1
  await loginOwner(page, async () => {
    await page.route('**/api/registrations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [], archived: [] }) }))
    await page.route('**/api/attendance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phase: 'idle', events: [], entries: [] }) }))
    await page.route('**/api/schedule-v2**', (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('resource') === 'entries') {
        const from = url.searchParams.get('from')
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [{ id: 'resume-shift', employeeUserId: 'employee-1', employeeName: `Version ${version}`, date: from, start: '07:00', end: '17:00', pauseMinutes: 0, location: 'Objekt', workArea: 'Dienst', status: 'published' }] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ objects: [] }) })
    })
  })

  await navigate(page, 'Dienstplan')
  await expect(page.getByText('Version 1').first()).toBeVisible()
  version = 2
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')))
  await expect(page.getByText('Version 2').first()).toBeVisible()
  await expect(page.locator('.auth-page')).toHaveCount(0)
})
```

- [ ] **Step 2: Run and verify RED before the feature is wired**

```bash
npx playwright test tests/e2e/performance-loading.spec.mjs --grep "resume"
```

Expected: FAIL before Task 2/3 wiring, PASS afterward.

- [ ] **Step 3: Add failure-preserves-old-data coverage**

Route the refresh request to `500` after the initial successful render and assert the original shift remains visible. Do not assert an empty state.

- [ ] **Step 4: Run focused and full verification**

```bash
npx playwright test tests/e2e/performance-loading.spec.mjs
npm run verify
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/performance-loading.spec.mjs
git commit -m "test: cover portal resume data refresh"
```

---

## Final verification

Run:

```bash
npm run verify
npm run build
npm run test:e2e
```

Acceptance criteria:

- Returning from the iPhone/Android background refreshes the visible page without closing the app.
- An open app refreshes after a relevant push.
- Existing data stays visible while refreshes run or fail.
- Dynamic reads stay `no-store`; existing memory-only cache behavior remains.
- Authentication behavior is unchanged.
