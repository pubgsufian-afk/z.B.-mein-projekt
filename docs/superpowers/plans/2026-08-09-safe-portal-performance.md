# Sichere Portal-Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Habun Mitarbeiterportal soll sich nach der Anmeldung und beim erneuten Öffnen bereits besuchter Bereiche schneller anfühlen, ohne Dienstplan, Zeiterfassung, PDF/Excel, Rollen, Berechtigungen, Datenbankverhalten, Design oder Bedienabläufe fachlich zu verändern.

**Architecture:** Die Optimierung bleibt im Frontend. Ein kleiner sitzungsgebundener In-Memory-Read-Cache dedupliziert identische GET-Anfragen und stellt bereits geladene Daten kurzzeitig sofort wieder bereit; im Hintergrund wird weiterhin frisch vom Server geladen. Schreibaktionen, Session-Prüfung und sicherheitskritische Autorisierung bleiben unverändert und umgehen den Cache vollständig. Zusätzlich nutzt die nachträglich injizierte Mitarbeiterrollen-/Profilverwaltung die bereits von React geladene Mitarbeiterliste, statt dieselben Daten erneut vom Server zu holen.

**Tech Stack:** React 19, JavaScript/ESM, Netlify Identity, Netlify Functions, esbuild, Node-Testskripte, Playwright E2E

## Global Constraints

- Keine fachliche Änderung an Dienstplan-Daten, Veröffentlichung, Wiederholungen oder Mitarbeiterzuordnung.
- Keine fachliche Änderung an Zeiterfassung, Standortprüfung, Pausen, Ein-/Ausstempeln oder Zeitkorrekturen.
- Keine Änderung an PDF-, Excel- oder Berichtserzeugung.
- Keine Änderung an Rollen, Rechten oder Hauptadmin-Schutz.
- Keine Änderung an Registrierungslogik oder Freigaben.
- Keine Änderung an Einsatzort-Daten oder Geofence-Regeln.
- Keine Änderung an Neon-Datenbankstruktur, Netlify-Blobs oder bestehenden API-Verträgen.
- Keine Änderung an Design, Navigation, sichtbaren Texten oder Bedienabläufen.
- Nur GET-/Leseanfragen dürfen in den In-Memory-Cache gelangen.
- Kein localStorage, kein IndexedDB, keine Offline-Persistenz.
- Session- und Sicherheitsprüfungen dürfen nicht aus dem Read-Cache beantwortet werden.
- Fehlerantworten und Schreibantworten werden nie gecacht.
- Cache wird bei Logout und Sessionwechsel vollständig geleert.
- Dienstplan-Cache-Schlüssel enthalten immer den vollständigen Ressourcenpfad inklusive Zeitraum/Woche.
- Mitarbeiterzuordnung erfolgt ausschließlich über stabile `userId`/`id`-Werte, niemals über Listenpositionen.
- Produktion wird erst nach vollständigem Verify, Build, E2E, Preview-Prüfung und ausdrücklicher Freigabe veröffentlicht.

---

## File Structure

- Create: `frontend/src/read-cache.js` — einzige Verantwortung: sitzungsgebundene GET-Deduplizierung, TTL, synchrones Lesen vorhandener Snapshots, gezielte Invalidierung und komplettes Leeren.
- Modify: `frontend/src/App.jsx` — verwendet den Cache ausschließlich bei ausgewählten nicht-sicherheitskritischen Leseabfragen; invalidiert ihn nach bestehenden Schreibaktionen; veröffentlicht den bereits geladenen Mitarbeiter-Snapshot an die Rollen-/Profilverwaltung.
- Modify: `frontend/src/employee-role-management-auto.js` — verwendet bevorzugt den von React gelieferten Mitarbeiter-/Session-Snapshot und greift nur als Fallback auf bestehende API-Leseaufrufe zurück.
- Create: `scripts/read-cache-test.mjs` — isolierte Tests für TTL, Inflight-Deduplizierung, Invalidierung und Logout-Clear.
- Modify: `scripts/employee-role-management-policy-test.mjs` — Source-Contract für Snapshot-Wiederverwendung und unveränderte serverseitige Rollenprüfung.
- Create: `tests/e2e/performance-loading.spec.mjs` — Request-Zählung, Cache-Revisit, Wochenisolation, Logout-Clear und unveränderte Schreibpfade.
- Modify: `package.json` — neue Performance-Regressionsprüfung in `verify:v2` und E2E-Datei in `test:e2e` aufnehmen.

---

### Task 1: Kleinen sitzungsgebundenen Read-Cache einführen

**Files:**
- Create: `frontend/src/read-cache.js`
- Create: `scripts/read-cache-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `readCachedJson(key, loader, { ttlMs, backgroundRefresh }) -> Promise<unknown>`
- Produces: `peekCachedJson(key) -> unknown | undefined`
- Produces: `invalidateCachedJson(keyOrPredicate) -> void`
- Produces: `clearReadCache() -> void`
- Produces: `primeCachedJson(key, value, ttlMs) -> void`
- Cache keys are exact request strings, e.g. `/api/registrations` or `/api/schedule-v2?resource=entries&from=2026-08-03&to=2026-08-09`.

- [ ] **Step 1: Write the failing cache tests**

Create `scripts/read-cache-test.mjs` with a fake clock and loader counters. Cover these exact cases:

```js
import assert from 'node:assert/strict'
import {
  clearReadCache,
  invalidateCachedJson,
  peekCachedJson,
  primeCachedJson,
  readCachedJson,
} from '../frontend/src/read-cache.js'

clearReadCache()

let calls = 0
const loader = async () => ({ version: ++calls })

const first = await readCachedJson('/api/registrations', loader, { ttlMs: 30000 })
const second = await readCachedJson('/api/registrations', loader, { ttlMs: 30000 })
assert.deepEqual(first, { version: 1 })
assert.deepEqual(second, { version: 1 })
assert.equal(calls, 1, 'fresh cache must avoid duplicate GET')

invalidateCachedJson('/api/registrations')
const third = await readCachedJson('/api/registrations', loader, { ttlMs: 30000 })
assert.deepEqual(third, { version: 2 })
assert.equal(calls, 2)

primeCachedJson('/api/schedule-v2?resource=entries&from=A&to=B', { entries: ['week-a'] }, 30000)
primeCachedJson('/api/schedule-v2?resource=entries&from=C&to=D', { entries: ['week-b'] }, 30000)
assert.deepEqual(peekCachedJson('/api/schedule-v2?resource=entries&from=A&to=B'), { entries: ['week-a'] })
assert.deepEqual(peekCachedJson('/api/schedule-v2?resource=entries&from=C&to=D'), { entries: ['week-b'] })

clearReadCache()
assert.equal(peekCachedJson('/api/registrations'), undefined)

console.log('read-cache-test: PASS')
```

Add a second assertion block where two simultaneous calls share one in-flight loader promise:

```js
clearReadCache()
let resolveLoader
let inflightCalls = 0
const slowLoader = () => {
  inflightCalls += 1
  return new Promise((resolve) => { resolveLoader = resolve })
}
const p1 = readCachedJson('/api/worksites', slowLoader, { ttlMs: 30000 })
const p2 = readCachedJson('/api/worksites', slowLoader, { ttlMs: 30000 })
assert.equal(inflightCalls, 1)
resolveLoader({ objects: [] })
assert.deepEqual(await p1, { objects: [] })
assert.deepEqual(await p2, { objects: [] })
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node scripts/read-cache-test.mjs
```

Expected: FAIL because `frontend/src/read-cache.js` does not exist yet.

- [ ] **Step 3: Implement the minimal cache module**

Create `frontend/src/read-cache.js` with only in-memory module state:

```js
const values = new Map()
const inflight = new Map()

function now() { return Date.now() }

export function peekCachedJson(key) {
  const entry = values.get(String(key))
  if (!entry || entry.expiresAt <= now()) return undefined
  return entry.value
}

export function primeCachedJson(key, value, ttlMs = 15000) {
  values.set(String(key), {
    value,
    expiresAt: now() + Math.max(0, Number(ttlMs) || 0),
  })
  return value
}

export async function readCachedJson(key, loader, { ttlMs = 15000, backgroundRefresh = false } = {}) {
  const cacheKey = String(key)
  const cached = peekCachedJson(cacheKey)
  if (cached !== undefined) {
    if (backgroundRefresh && !inflight.has(cacheKey)) {
      const refresh = Promise.resolve().then(loader)
        .then((value) => primeCachedJson(cacheKey, value, ttlMs))
        .finally(() => inflight.delete(cacheKey))
      inflight.set(cacheKey, refresh)
      refresh.catch(() => {})
    }
    return cached
  }

  if (inflight.has(cacheKey)) return inflight.get(cacheKey)
  const request = Promise.resolve().then(loader)
    .then((value) => primeCachedJson(cacheKey, value, ttlMs))
    .finally(() => inflight.delete(cacheKey))
  inflight.set(cacheKey, request)
  return request
}

export function invalidateCachedJson(keyOrPredicate) {
  if (typeof keyOrPredicate === 'function') {
    for (const key of values.keys()) if (keyOrPredicate(key)) values.delete(key)
    for (const key of inflight.keys()) if (keyOrPredicate(key)) inflight.delete(key)
    return
  }
  const key = String(keyOrPredicate)
  values.delete(key)
  inflight.delete(key)
}

export function clearReadCache() {
  values.clear()
  inflight.clear()
}
```

Do not add storage APIs or cache persistence.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node scripts/read-cache-test.mjs
```

Expected: `read-cache-test: PASS`.

- [ ] **Step 5: Wire the test into verification**

In `package.json`, add `node scripts/read-cache-test.mjs` to `verify:v2` without removing any existing checks.

- [ ] **Step 6: Run the full source verification**

Run:

```bash
npm run verify
```

Expected: exit code 0; all existing verification remains green.

- [ ] **Step 7: Commit Task 1**

```bash
git add frontend/src/read-cache.js scripts/read-cache-test.mjs package.json
git commit -m "perf: add safe session read cache"
```

---

### Task 2: Doppelte Mitarbeiter- und Session-Leseaufrufe entfernen

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/employee-role-management-auto.js`
- Modify: `scripts/employee-role-management-policy-test.mjs`
- Test: `tests/e2e/employee-role-management.spec.mjs`

**Interfaces:**
- Consumes: existing React `EmployeesPage` data from `/api/registrations`.
- Produces browser event: `habun:employee-snapshot` with `detail: { session: { role, userId }, employees: Array }`.
- `employee-role-management-auto.js` stores the latest snapshot only in module memory and uses it for rendering controls.
- Server PATCH calls remain exactly on `/api/registrations` and server authorization remains authoritative.

- [ ] **Step 1: Add failing source-contract assertions**

Extend `scripts/employee-role-management-policy-test.mjs`:

```js
assert.match(appSource, /habun:employee-snapshot/)
assert.match(editor, /habun:employee-snapshot/)
assert.match(editor, /snapshotEmployees/)
```

Also assert the existing server policy text still exists:

```js
assert.match(registrations, /employeeManagementPolicy/)
assert.match(registrations, /requirePortalRole/)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node scripts/employee-role-management-policy-test.mjs
```

Expected: FAIL on missing snapshot event/source symbols.

- [ ] **Step 3: Publish the already loaded React snapshot**

In `EmployeesPage`, after successful `setData(...)`, dispatch the exact event with the same data already returned by the server:

```js
const next = await apiJson('/api/registrations')
setData(next)
window.dispatchEvent(new CustomEvent('habun:employee-snapshot', {
  detail: {
    session: { role: session.role, userId: session.userId },
    employees: Array.isArray(next.employees) ? next.employees : [],
  },
}))
```

Do not dispatch registration requests, archived data, passwords, tokens, email-auth state or any new private fields.

- [ ] **Step 4: Consume the snapshot in the injected editor**

In `employee-role-management-auto.js`, add module-memory values:

```js
let snapshotEmployees = []
let snapshotSession = null
```

Register one listener inside `installEmployeeRoleManagement()`:

```js
window.addEventListener('habun:employee-snapshot', (event) => {
  const detail = event.detail || {}
  snapshotEmployees = Array.isArray(detail.employees) ? detail.employees : []
  snapshotSession = detail.session && typeof detail.session === 'object' ? detail.session : null
  scheduleRefresh(0)
})
```

Update `refresh()` to prefer the snapshot:

```js
const currentSession = snapshotSession || await session()
const employees = snapshotEmployees.length
  ? snapshotEmployees
  : (await api('/api/registrations')).employees || []
```

When leaving the Mitarbeiter page, clear only the page-local snapshot:

```js
snapshotEmployees = []
snapshotSession = null
```

Keep the existing API fallback so direct loads and unexpected render orders remain functional.

- [ ] **Step 5: Ensure server-protected writes are unchanged**

Do not change these existing request bodies:

```js
{ id, action: 'update-profile', fullName, company, location }
{ id, action: 'update-role', role: nextRole }
{ id, action: 'deactivate-account' }
```

No authorization decision may be added to the client.

- [ ] **Step 6: Run policy and role-management E2E tests**

Run:

```bash
node scripts/employee-role-management-policy-test.mjs
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: both pass; Hauptadmin edit/protection behavior unchanged.

- [ ] **Step 7: Commit Task 2**

```bash
git add frontend/src/App.jsx frontend/src/employee-role-management-auto.js scripts/employee-role-management-policy-test.mjs
git commit -m "perf: reuse employee data in profile controls"
```

---

### Task 3: Sichere Wiederverwendung ausgewählter GET-Daten beim Seitenwechsel

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `tests/e2e/performance-loading.spec.mjs`

**Interfaces:**
- Consumes: `readCachedJson`, `peekCachedJson`, `invalidateCachedJson`, `clearReadCache` from `frontend/src/read-cache.js`.
- Cache allowed only for:
  - `/api/registrations` — TTL 20 seconds.
  - `/api/schedule-v2?resource=objects` — TTL 30 seconds.
  - exact week-scoped schedule entry GET URL — TTL 8 seconds, key includes `from` and `to`.
- Cache explicitly forbidden for `/api/session`, attendance state/live/history, PDF/Excel blob routes and all non-GET requests.

- [ ] **Step 1: Write failing E2E tests for request reduction and week isolation**

Create `tests/e2e/performance-loading.spec.mjs` with mocked APIs and counters. Cover at least:

```js
test('revisiting Mitarbeiter reuses one short-lived registration snapshot', async ({ page }) => {
  let registrationGets = 0
  await page.route('**/api/registrations', async (route) => {
    if (route.request().method() === 'GET') registrationGets += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], employees: [{ userId: 'e1', fullName: 'Test', role: 'employee', status: 'active' }], archived: [] }) })
  })
  // mock login/session and other required endpoints using the existing helpers/patterns
  // open Mitarbeiter, switch away, open Mitarbeiter again quickly
  expect(registrationGets).toBeLessThanOrEqual(2)
})
```

And week isolation:

```js
test('schedule cache never mixes two different weeks', async ({ page }) => {
  const seen = []
  await page.route('**/api/schedule-v2?resource=entries**', async (route) => {
    const url = new URL(route.request().url())
    const from = url.searchParams.get('from')
    seen.push(from)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [{ id: from, date: from, start: '07:00', end: '17:00' }] }) })
  })
  // navigate current week then next week and assert each rendered id/date matches its requested `from`
})
```

- [ ] **Step 2: Run the new E2E file and verify RED**

Run:

```bash
npx playwright test tests/e2e/performance-loading.spec.mjs
```

Expected: RED because no shared read-cache integration exists yet.

- [ ] **Step 3: Import cache helpers into App.jsx**

Add:

```js
import {
  clearReadCache,
  invalidateCachedJson,
  peekCachedJson,
  readCachedJson,
} from './read-cache.js'
```

Do not modify `apiJson()` itself. Keeping `apiJson()` uncached guarantees all existing callers remain unchanged unless explicitly opted into the new cache.

- [ ] **Step 4: Add an opt-in cached GET helper inside App.jsx**

Add:

```js
function cachedGet(path, ttlMs) {
  return readCachedJson(path, () => apiJson(path), {
    ttlMs,
    backgroundRefresh: true,
  })
}
```

No method/options argument is accepted. This prevents accidental caching of writes.

- [ ] **Step 5: Use cached GET only for employee directory reads**

Replace selected plain GETs of `/api/registrations` in `EmployeesPage`, schedule employee directory loading and Reports employee selector loading with:

```js
cachedGet('/api/registrations', 20000)
```

Do not change registration approval/reject/profile/role/deactivate PATCH calls.

- [ ] **Step 6: Use exact-key cache for schedule objects and week entries**

In `SchedulePage.load()` construct the existing exact URLs first:

```js
const entriesUrl = `/api/schedule-v2?resource=entries&from=${from}&to=${to}`
const calls = [cachedGet(entriesUrl, 8000)]
if (management) {
  calls.push(
    cachedGet('/api/schedule-v2?resource=objects', 30000),
    cachedGet('/api/registrations', 20000),
  )
}
```

This preserves the existing `Promise.all` structure and guarantees different weeks receive different keys.

- [ ] **Step 7: Invalidate only affected read data after existing writes**

After a successful employee approve/reject/profile/role/deactivate mutation:

```js
invalidateCachedJson('/api/registrations')
```

After a successful schedule save/delete/repeat/publish/copy action:

```js
invalidateCachedJson((key) => key.startsWith('/api/schedule-v2?resource=entries'))
```

If a schedule action can create/update employee directory metadata, additionally invalidate `/api/registrations`; otherwise do not broaden invalidation.

After worksite create/update/delete:

```js
invalidateCachedJson('/api/schedule-v2?resource=objects')
```

Do not invalidate PDF/report cache because no PDF/report cache exists.

- [ ] **Step 8: Clear cache on logout and session identity changes**

At the start of `signOut()`:

```js
clearReadCache()
```

Before applying a newly authenticated user/session inside the auth change callback, call `clearReadCache()` whenever the identity user id changes.

Do not cache `/api/session`.

- [ ] **Step 9: Run focused performance E2E**

Run:

```bash
npx playwright test tests/e2e/performance-loading.spec.mjs
```

Expected: PASS.

- [ ] **Step 10: Run existing schedule, attendance and employee E2E**

Run:

```bash
npx playwright test tests/e2e/unified-portal.spec.mjs tests/e2e/worksite-feature.spec.mjs tests/e2e/admin-time-editing.spec.mjs tests/e2e/employee-role-management.spec.mjs
```

Expected: PASS with no behavior changes.

- [ ] **Step 11: Commit Task 3**

```bash
git add frontend/src/App.jsx tests/e2e/performance-loading.spec.mjs
git commit -m "perf: reuse safe read data between portal pages"
```

---

### Task 4: Final regression gate, build and preview

**Files:**
- Modify: `package.json`
- Verify only: all production source and tests

**Interfaces:**
- No new runtime interface.
- Final gate requires all existing tests plus the new performance suite.

- [ ] **Step 1: Add performance E2E file to the standard command**

Update `test:e2e` so it includes:

```text
tests/e2e/performance-loading.spec.mjs
```

Keep every existing E2E file already present in the command.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run verify
```

Expected: exit code 0.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: exit code 0 and frontend bundle created successfully.

- [ ] **Step 4: Run complete E2E suite**

Run:

```bash
npm run test:e2e
```

Expected: 0 failed tests.

- [ ] **Step 5: Explicitly verify protected areas were not modified**

Run git diff checks and confirm there are no changes under PDF/report backend files or database/schema files:

```bash
git diff --name-only main...HEAD
```

Expected runtime changes are limited to:

```text
frontend/src/read-cache.js
frontend/src/App.jsx
frontend/src/employee-role-management-auto.js
scripts/read-cache-test.mjs
scripts/employee-role-management-policy-test.mjs
tests/e2e/performance-loading.spec.mjs
package.json
```

Documentation files under `docs/superpowers/` are also expected.

If any `netlify/functions/*pdf*`, `netlify/functions/*report*`, schedule database repository, attendance backend, Neon schema or migration file appears unexpectedly, stop and inspect before proceeding.

- [ ] **Step 6: Verify critical user flows in preview**

In the Netlify deploy preview, verify:

1. Login completes and the initial management page loads without showing a false final empty state.
2. Mitarbeiter page shows the same names, roles and Hauptadmin protection as production.
3. Open Mitarbeiter, switch to another area, return quickly; controls appear without a second visible delayed phase.
4. Open Dienstplan current week, then next week; employees and shifts remain correctly assigned.
5. Save/edit a test shift in preview; refresh data and verify the just-written shift is immediately visible.
6. Clock-in/out and pause flows behave identically in E2E; do not perform production attendance writes.
7. PDF/Excel routes are tested only through existing automated contracts in this change; no export implementation file is touched.
8. Logout, login as a different mocked/test identity, and confirm no prior cached employee/schedule data remains.

- [ ] **Step 7: Commit final test-command update**

```bash
git add package.json
git commit -m "test: gate portal performance changes with e2e"
```

- [ ] **Step 8: Create a draft PR only after all gates pass**

PR title:

```text
Portal-Ladezeiten sicher beschleunigen
```

PR body must explicitly state:

```text
- Keine Änderungen an PDF/Excel-Erzeugung
- Keine Änderungen an Dienstplan- oder Zeiterfassungs-Backendlogik
- Keine Änderungen an Rollen-/Rechtepolicy
- In-Memory-Cache nur für ausgewählte GET-Leseanfragen
- Cache wird nach Writes und bei Logout/Sessionwechsel invalidiert
- Vollständiges verify, build und E2E erfolgreich
```

Do not merge or deploy production in this task. Wait for explicit publication approval after preview verification.
