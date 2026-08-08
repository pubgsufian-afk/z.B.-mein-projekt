# Sichere Portal-Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Habun Mitarbeiterportal soll sich nach der Anmeldung und beim Wechsel zwischen Bereichen schneller und stabiler anfühlen, ohne Dienstplan, Zeiterfassung, PDF/Excel, Rollen, Berechtigungen, Datenbankverhalten, Design oder Bedienabläufe fachlich zu verändern.

**Architecture:** Die Optimierung bleibt vollständig im Frontend. Nur relativ stabile Verzeichnisdaten (`/api/registrations` und Einsatzort-/Objektliste) dürfen innerhalb derselben Anmeldung kurz im Arbeitsspeicher gehalten werden. Beim erneuten Öffnen werden diese Daten sofort angezeigt, gleichzeitig aber immer frisch vom Server bestätigt und danach ersetzt. Dienstplan-Einträge, Anwesenheit, Session, Rollenentscheidungen, PDF/Excel und alle Schreibaktionen werden niemals aus dem Cache beantwortet. Die Mitarbeiter-Rollen-/Profil-Erweiterung verwendet die bereits von React geladene Mitarbeiterliste statt einen zweiten identischen Serverabruf zu starten.

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
- Kein `localStorage`, kein `IndexedDB`, keine Offline-Persistenz.
- `/api/session` wird nie gecacht.
- `/api/attendance*` wird nie gecacht.
- Dienstplan-Einträge `/api/schedule-v2?resource=entries...` werden nie gecacht.
- PDF-/Excel-/Berichtsrouten werden nie gecacht.
- Fehlerantworten und Schreibantworten werden nie gecacht.
- Cache wird bei Logout und Identitäts-/Sessionwechsel vollständig geleert.
- Mitarbeiterzuordnung erfolgt ausschließlich über stabile `userId`/`id`-Werte, niemals über Listenpositionen.
- Produktion wird erst nach vollständigem Verify, Build, E2E, Preview-Prüfung und ausdrücklicher Freigabe veröffentlicht.

---

## File Structure

- Create: `frontend/src/read-cache.js` — sitzungsgebundene Snapshots für ausgewählte GET-Verzeichnisdaten, Inflight-Deduplizierung, Invalidierung und vollständiges Leeren.
- Modify: `frontend/src/App.jsx` — nutzt Snapshots nur bei Mitarbeiter-/Objektverzeichnissen, lädt danach immer frisch, invalidiert nach bestehenden Schreibaktionen und parallelisiert eine bestehende Anwesenheits-Leseabfolge.
- Modify: `frontend/src/employee-role-management-auto.js` — verwendet den bereits geladenen React-Mitarbeitersnapshot statt `/api/session` und `/api/registrations` nochmals unmittelbar zu lesen.
- Create: `scripts/read-cache-test.mjs` — isolierte Tests für Snapshot, Inflight-Deduplizierung, Invalidierung und Clear.
- Modify: `scripts/employee-role-management-policy-test.mjs` — Source-Contract für Snapshot-Wiederverwendung bei unveränderter serverseitiger Autorisierung.
- Modify: `tests/e2e/employee-role-management.spec.mjs` — Request-Zählung für die Mitarbeiterseite sowie bestehende Hauptadmin-/Admin-Regressionen.
- Create: `tests/e2e/performance-loading.spec.mjs` — Cache-Revisit, frische Serverbestätigung, Logout-Clear und Dienstplan-Nicht-Caching.
- Modify: `package.json` — neue Cache-Prüfung und Performance-E2E in Standard-Gates aufnehmen.

---

### Task 1: Sicheren In-Memory-Verzeichnis-Cache einführen

**Files:**
- Create: `frontend/src/read-cache.js`
- Create: `scripts/read-cache-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `peekCachedJson(key) -> unknown | undefined`
- Produces: `refreshCachedJson(key, loader, { ttlMs }) -> Promise<unknown>`
- Produces: `invalidateCachedJson(keyOrPredicate) -> void`
- Produces: `clearReadCache() -> void`
- Produces: `primeCachedJson(key, value, ttlMs) -> unknown`
- `refreshCachedJson()` führt bei jedem neuen Seiten-Ladevorgang einen echten Loader-Aufruf aus, dedupliziert aber gleichzeitig laufende identische Requests. Dadurch kann ein vorhandener Snapshot sofort angezeigt werden, ohne die anschließende Serverbestätigung zu überspringen.

- [ ] **Step 1: Write the failing unit test**

Create `scripts/read-cache-test.mjs`:

```js
import assert from 'node:assert/strict'
import {
  clearReadCache,
  invalidateCachedJson,
  peekCachedJson,
  primeCachedJson,
  refreshCachedJson,
} from '../frontend/src/read-cache.js'

clearReadCache()
assert.equal(peekCachedJson('/api/registrations'), undefined)

primeCachedJson('/api/registrations', { employees: [{ userId: 'e1' }] }, 30000)
assert.deepEqual(peekCachedJson('/api/registrations'), { employees: [{ userId: 'e1' }] })

invalidateCachedJson('/api/registrations')
assert.equal(peekCachedJson('/api/registrations'), undefined)

let calls = 0
let release
const loader = () => {
  calls += 1
  return new Promise((resolve) => { release = resolve })
}
const p1 = refreshCachedJson('/api/registrations', loader, { ttlMs: 30000 })
const p2 = refreshCachedJson('/api/registrations', loader, { ttlMs: 30000 })
assert.equal(calls, 1, 'gleichzeitige identische GETs müssen dedupliziert werden')
release({ employees: [{ userId: 'e2' }] })
assert.deepEqual(await p1, { employees: [{ userId: 'e2' }] })
assert.deepEqual(await p2, { employees: [{ userId: 'e2' }] })
assert.deepEqual(peekCachedJson('/api/registrations'), { employees: [{ userId: 'e2' }] })

clearReadCache()
assert.equal(peekCachedJson('/api/registrations'), undefined)

console.log('read-cache-test: PASS')
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node scripts/read-cache-test.mjs
```

Expected: FAIL because `frontend/src/read-cache.js` does not exist yet.

- [ ] **Step 3: Implement the minimal cache**

Create `frontend/src/read-cache.js`:

```js
const values = new Map()
const inflight = new Map()

export function peekCachedJson(key) {
  const cacheKey = String(key)
  const entry = values.get(cacheKey)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    values.delete(cacheKey)
    return undefined
  }
  return entry.value
}

export function primeCachedJson(key, value, ttlMs = 15000) {
  values.set(String(key), {
    value,
    expiresAt: Date.now() + Math.max(0, Number(ttlMs) || 0),
  })
  return value
}

export async function refreshCachedJson(key, loader, { ttlMs = 15000 } = {}) {
  const cacheKey = String(key)
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)
  const request = Promise.resolve()
    .then(loader)
    .then((value) => primeCachedJson(cacheKey, value, ttlMs))
    .finally(() => inflight.delete(cacheKey))
  inflight.set(cacheKey, request)
  return request
}

export function invalidateCachedJson(keyOrPredicate) {
  if (typeof keyOrPredicate === 'function') {
    for (const key of [...values.keys()]) if (keyOrPredicate(key)) values.delete(key)
    return
  }
  values.delete(String(keyOrPredicate))
}

export function clearReadCache() {
  values.clear()
  inflight.clear()
}
```

No browser persistence API may be added.

- [ ] **Step 4: Run focused test**

Run:

```bash
node scripts/read-cache-test.mjs
```

Expected: `read-cache-test: PASS`.

- [ ] **Step 5: Add the test to `verify:v2`**

Append `node scripts/read-cache-test.mjs` to the existing `verify:v2` command in `package.json`; keep every existing command.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm run verify
```

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/read-cache.js scripts/read-cache-test.mjs package.json
git commit -m "perf: add safe session directory cache"
```

---

### Task 2: Mitarbeiterseite ohne zweiten Datenabruf rendern

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/employee-role-management-auto.js`
- Modify: `scripts/employee-role-management-policy-test.mjs`
- Modify: `tests/e2e/employee-role-management.spec.mjs`

**Interfaces:**
- Produces event: `habun:employee-snapshot`
- Event detail: `{ session: { role: string, userId: string }, employees: Array<object> }`
- Server PATCH requests and `employeeManagementPolicy` bleiben unverändert.

- [ ] **Step 1: Add failing source assertions**

In `scripts/employee-role-management-policy-test.mjs`, read `frontend/src/App.jsx` into `appSource` and add:

```js
assert.match(appSource, /habun:employee-snapshot/)
assert.match(editor, /habun:employee-snapshot/)
assert.match(editor, /snapshotEmployees/)
assert.match(registrations, /employeeManagementPolicy/)
assert.match(registrations, /requirePortalRole/)
```

- [ ] **Step 2: Run focused source test to verify RED**

Run:

```bash
node scripts/employee-role-management-policy-test.mjs
```

Expected: FAIL on missing snapshot symbols.

- [ ] **Step 3: Change `EmployeesPage.load()` to show cached directory immediately and always refresh**

Import cache helpers into `App.jsx`:

```js
import {
  clearReadCache,
  invalidateCachedJson,
  peekCachedJson,
  refreshCachedJson,
} from './read-cache.js'
```

Add constants:

```js
const REGISTRATIONS_CACHE_KEY = '/api/registrations'
const OBJECTS_CACHE_KEY = '/api/schedule-v2?resource=objects'
```

Replace only the GET implementation inside `EmployeesPage.load()` with this pattern:

```js
const publishSnapshot = (next) => {
  setData(next)
  window.dispatchEvent(new CustomEvent('habun:employee-snapshot', {
    detail: {
      session: { role: session.role, userId: session.userId },
      employees: Array.isArray(next.employees) ? next.employees : [],
    },
  }))
}

const load = useCallback(async () => {
  try {
    const cached = peekCachedJson(REGISTRATIONS_CACHE_KEY)
    if (cached) publishSnapshot(cached)

    const fresh = await refreshCachedJson(
      REGISTRATIONS_CACHE_KEY,
      () => apiJson('/api/registrations'),
      { ttlMs: 20000 },
    )
    publishSnapshot(fresh)
    setNotice(null)
  } catch (error) {
    setNotice({ tone: 'error', text: error.message })
  }
}, [session.role, session.userId])
```

The cached value is never treated as a security decision; the fresh server result always replaces it as soon as it returns.

- [ ] **Step 4: Invalidate employee directory after existing employee writes**

After a successful approve/reject operation in `EmployeesPage.decide()` and after successful profile/role/deactivate actions from the injected editor, call:

```js
invalidateCachedJson(REGISTRATIONS_CACHE_KEY)
```

For `employee-role-management-auto.js`, add a small event-based invalidation request rather than importing React internals:

```js
window.dispatchEvent(new CustomEvent('habun:invalidate-read-cache', {
  detail: { key: '/api/registrations' },
}))
```

In `App.jsx`, install one listener in `UnifiedPortal` or `App` that accepts only the two explicit allowlisted keys:

```js
useEffect(() => {
  const allowed = new Set([REGISTRATIONS_CACHE_KEY, OBJECTS_CACHE_KEY])
  const onInvalidate = (event) => {
    const key = String(event.detail?.key || '')
    if (allowed.has(key)) invalidateCachedJson(key)
  }
  window.addEventListener('habun:invalidate-read-cache', onInvalidate)
  return () => window.removeEventListener('habun:invalidate-read-cache', onInvalidate)
}, [])
```

- [ ] **Step 5: Make the injected employee controls consume the React snapshot first**

In `employee-role-management-auto.js`, add:

```js
let snapshotEmployees = []
let snapshotSession = null
let snapshotReceivedAt = 0
```

Inside `installEmployeeRoleManagement()` register:

```js
window.addEventListener('habun:employee-snapshot', (event) => {
  const detail = event.detail || {}
  snapshotEmployees = Array.isArray(detail.employees) ? detail.employees : []
  snapshotSession = detail.session && typeof detail.session === 'object' ? detail.session : null
  snapshotReceivedAt = Date.now()
  scheduleRefresh(0)
})
```

In `refresh()`, prefer the snapshot when it belongs to the current rendered page:

```js
const hasRecentSnapshot = snapshotSession && Date.now() - snapshotReceivedAt < 60000
const currentSession = hasRecentSnapshot ? snapshotSession : await session()
const employees = hasRecentSnapshot
  ? snapshotEmployees
  : (Array.isArray((await api('/api/registrations')).employees) ? (await api('/api/registrations')).employees : [])
```

Do not use the duplicated fallback expression above literally. Implement the fallback with one request variable:

```js
let employees = snapshotEmployees
if (!hasRecentSnapshot) {
  const data = await api('/api/registrations')
  employees = Array.isArray(data.employees) ? data.employees : []
}
```

Keep all server-side PATCH authorization unchanged.

- [ ] **Step 6: Add a GET-count regression to existing Playwright test**

In `tests/e2e/employee-role-management.spec.mjs`, extend `mockPortal()` with `let registrationGets = 0`. Increment only for GET requests:

```js
if (request.method() === 'GET') registrationGets += 1
```

Return it:

```js
return { user, getLastPatch: () => lastPatch, getRegistrationGets: () => registrationGets }
```

In `Hauptadmin may assign Admin and deactivate normal accounts`, after the page and controls are visible, assert:

```js
await expect.poll(() => portal.getRegistrationGets()).toBeLessThanOrEqual(2)
```

The expected maximum of 2 permits the initial React directory load plus one fallback during unusual startup ordering, but prevents uncontrolled repeated reads caused by MutationObserver refreshes.

- [ ] **Step 7: Run employee regressions**

Run:

```bash
node scripts/employee-role-management-policy-test.mjs
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: PASS; existing Hauptadmin, Admin, role and profile tests remain unchanged.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.jsx frontend/src/employee-role-management-auto.js scripts/employee-role-management-policy-test.mjs tests/e2e/employee-role-management.spec.mjs
git commit -m "perf: reuse loaded employee directory"
```

---

### Task 3: Schnelle Verzeichnis-Snapshots und parallele Anwesenheits-Leseabfragen

**Files:**
- Modify: `frontend/src/App.jsx`
- Create: `tests/e2e/performance-loading.spec.mjs`

**Interfaces:**
- Employee directory key: `/api/registrations`, TTL 20 seconds.
- Object directory key: `/api/schedule-v2?resource=objects`, TTL 30 seconds.
- Schedule entry URLs are explicitly excluded from cache.
- Attendance URLs are explicitly excluded from cache.

- [ ] **Step 1: Add an exact helper for cached-then-fresh directory loads**

Inside `App.jsx`, add:

```js
async function loadDirectoryFresh(key, path, ttlMs, apply) {
  const cached = peekCachedJson(key)
  if (cached !== undefined) apply(cached)
  const fresh = await refreshCachedJson(key, () => apiJson(path), { ttlMs })
  apply(fresh)
  return fresh
}
```

This helper is used only with the two allowlisted directory keys.

- [ ] **Step 2: Use the helper in SchedulePage only for objects and employee directory**

Keep schedule entries completely fresh:

```js
const from = week
const to = addDays(week, 6)
const entriesUrl = `/api/schedule-v2?resource=entries&from=${from}&to=${to}`
const shiftPromise = apiJson(entriesUrl)
```

For management, read cached directory values synchronously first:

```js
const cachedObjects = peekCachedJson(OBJECTS_CACHE_KEY)
if (cachedObjects) setObjects(cachedObjects.objects || [])
const cachedEmployees = peekCachedJson(REGISTRATIONS_CACHE_KEY)
if (cachedEmployees) setEmployees(cachedEmployees.employees || [])
```

Then refresh all three sources in parallel:

```js
const calls = [
  shiftPromise,
  refreshCachedJson(OBJECTS_CACHE_KEY, () => apiJson('/api/schedule-v2?resource=objects'), { ttlMs: 30000 }),
  refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson('/api/registrations'), { ttlMs: 20000 }),
]
const [shiftData, objectData, employeeData] = await Promise.all(calls)
setEntries(shiftData.entries || [])
setObjects(objectData.objects || [])
setEmployees(employeeData.employees || [])
```

For employees, keep only `shiftPromise`; do not fetch management directories.

- [ ] **Step 3: Use employee directory snapshot in ReportsPage**

On ReportsPage mount, first apply `peekCachedJson(REGISTRATIONS_CACHE_KEY)?.employees`, then call `refreshCachedJson(REGISTRATIONS_CACHE_KEY, () => apiJson('/api/registrations'), { ttlMs: 20000 })` and replace the list with the fresh result.

Do not change `apiBlob`, report payloads, PDF preview code, PDF routes or Excel routes.

- [ ] **Step 4: Parallelize existing AttendancePage management reads without caching**

Replace the sequential management load:

```js
const data = await apiJson('/api/attendance?resource=state')
setState(data)
if (MANAGEMENT.has(session.role)) {
  const liveData = await apiJson('/api/attendance?resource=live')
  setLive(liveData.entries || [])
}
```

with:

```js
const calls = [apiJson('/api/attendance?resource=state')]
if (MANAGEMENT.has(session.role)) calls.push(apiJson('/api/attendance?resource=live'))
const [data, liveData] = await Promise.all(calls)
setState(data)
if (MANAGEMENT.has(session.role)) setLive(liveData?.entries || [])
```

No attendance response is stored in the read-cache.

- [ ] **Step 5: Invalidate object directory after existing worksite mutations**

In the existing success paths for worksite create/update/delete in `WorksitesPage`, add only:

```js
invalidateCachedJson(OBJECTS_CACHE_KEY)
```

Do not alter worksite request URLs, payloads, map logic or geofence values.

- [ ] **Step 6: Clear all cached directory snapshots on logout and identity changes**

At the start of `signOut()`:

```js
clearReadCache()
```

Track the authenticated user id in a `useRef`. In the auth callback, before applying a different user id, clear the cache:

```js
const identityIdRef = useRef('')

// after resolving currentUser
const nextId = String(currentUser?.id || '')
if (identityIdRef.current && identityIdRef.current !== nextId) clearReadCache()
identityIdRef.current = nextId
```

When `currentUser` becomes null, clear the cache and set the ref to an empty string.

- [ ] **Step 7: Create performance E2E with complete local auth mocks**

Create `tests/e2e/performance-loading.spec.mjs`. Copy these exact helper shapes into the file so it is self-contained:

```js
import { test, expect } from '@playwright/test'

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function testUser() {
  return {
    id: 'owner-performance-test', email: 'owner.performance@example.test', aud: '', role: 'authenticated',
    app_metadata: { provider: 'email', roles: ['owner'] },
    user_metadata: { full_name: 'Hauptadmin Performance' },
    created_at: '2026-08-09T00:00:00.000Z', confirmed_at: '2026-08-09T00:00:00.000Z', updated_at: '2026-08-09T00:00:00.000Z',
  }
}
function tokenResponse(user) {
  const now = Math.floor(Date.now() / 1000)
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', sub: user.id, email: user.email, role: 'authenticated', exp: now + 3600, iat: now, app_metadata: user.app_metadata, user_metadata: user.user_metadata })}.test-signature`,
    token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh-token', user,
  }
}
async function mockIdentity(page, user) {
  let authenticated = false
  await page.route('**/.netlify/identity**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/settings')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: true, external: {} }) })
    if (url.pathname.endsWith('/token') && request.method() === 'POST') {
      authenticated = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokenResponse(user)) })
    }
    if (url.pathname.endsWith('/user')) return route.fulfill({ status: authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify(authenticated ? user : { error: 'invalid_token' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}
async function navigate(page, label) {
  const sidebar = page.locator('.sidebar')
  const menu = page.getByRole('button', { name: 'Menü öffnen' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await expect(sidebar).toHaveClass(/open/)
  }
  const target = sidebar.getByRole('button', { name: label, exact: true })
  await expect(target).toBeVisible()
  await target.evaluate((button) => button.click())
  await expect(page.locator('.topbar h1')).toHaveText(label)
}
```

- [ ] **Step 8: Add exact E2E assertions**

Mock `/api/session`, `/api/registrations`, `/api/schedule-v2`, `/api/attendance` and `/api/worksite-v2` with deterministic JSON. Then implement these tests:

1. `Mitarbeiter snapshot appears immediately on revisit and is replaced by fresh server data` — first GET returns `Adel Alt`, second GET returns `Adel Neu`; after leaving and returning, `Adel Alt` may render immediately, then the test must eventually see `Adel Neu` without reload.
2. `schedule entries are requested fresh for every week` — count every GET whose URL contains `resource=entries`; navigate current week, then click `Nächste ›`; assert a second distinct request with a different `from` parameter and assert the rendered date belongs to the second response.
3. `logout clears directory snapshots` — load Mitarbeiter once, logout, authenticate a second mock user with a different employee response, and assert the first employee name never appears after the second login.
4. `attendance state and live are still fresh network reads` — navigate to Zeiterfassung and assert one GET for `resource=state` and one GET for `resource=live`; neither may be satisfied from a stored directory snapshot.

- [ ] **Step 9: Run new performance E2E**

Run:

```bash
npx playwright test tests/e2e/performance-loading.spec.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/App.jsx tests/e2e/performance-loading.spec.mjs
git commit -m "perf: speed up safe portal reads"
```

---

### Task 4: Vollständiges Regression-Gate und Preview

**Files:**
- Modify: `package.json`
- Verify: complete repository

**Interfaces:**
- No new runtime API.
- Final gate must prove protected areas remain unchanged.

- [ ] **Step 1: Add performance E2E to standard command**

Append `tests/e2e/performance-loading.spec.mjs` to the existing `test:e2e` command. Do not remove any existing E2E file.

- [ ] **Step 2: Run full verification**

```bash
npm run verify
```

Expected: exit code 0.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Run complete E2E suite**

```bash
npm run test:e2e
```

Expected: 0 failed tests.

- [ ] **Step 5: Verify the change set is limited to performance/frontend files**

```bash
git diff --name-only main...HEAD
```

Allowed runtime/test files:

```text
frontend/src/read-cache.js
frontend/src/App.jsx
frontend/src/employee-role-management-auto.js
scripts/read-cache-test.mjs
scripts/employee-role-management-policy-test.mjs
tests/e2e/employee-role-management.spec.mjs
tests/e2e/performance-loading.spec.mjs
package.json
```

Documentation under `docs/superpowers/` is also expected.

Stop before PR if any of these unexpected areas appear:

```text
netlify/functions/*pdf*
netlify/functions/*report*
netlify/functions/attendance*.mts
netlify/functions/schedule-v2*.mts
netlify/functions/_shared/schedule-*.mts
any migration/schema file
```

- [ ] **Step 6: Verify critical flows in Deploy Preview**

Check these exact behaviors in preview:

1. Login succeeds with normal server session validation.
2. Mitarbeiter page shows the same names, roles and Hauptadmin protection as production.
3. Reopening Mitarbeiter shows the last directory quickly, then confirms/replaces it with the fresh server result.
4. Dienstplan current week and next week each load their own fresh `resource=entries` data; no week entry is cached.
5. Employee assignment remains based on `userId`/`id`.
6. Stempeluhr, Pause and Ausstempeln remain covered by existing E2E and no attendance backend file is changed.
7. PDF/Excel contract tests remain green and no PDF/report source file is changed.
8. Logout and different test login do not retain previous directory snapshots.

- [ ] **Step 7: Commit standard gate update**

```bash
git add package.json
git commit -m "test: gate portal performance optimization"
```

- [ ] **Step 8: Create draft PR only after every gate passes**

PR title:

```text
Portal-Ladezeiten sicher beschleunigen
```

PR body must include:

```text
- Keine Änderungen an PDF/Excel-Erzeugung
- Keine Änderungen an Dienstplan- oder Zeiterfassungs-Backendlogik
- Keine Änderungen an Rollen-/Rechtepolicy
- In-Memory-Snapshots nur für Mitarbeiter- und Objektverzeichnisse
- Dienstplan-Einträge, Attendance und Session bleiben immer frisch
- Cache wird nach Writes und bei Logout/Sessionwechsel invalidiert
- Vollständiges verify, build und E2E erfolgreich
```

Do not merge or deploy production. Wait for explicit publication approval after preview verification.
