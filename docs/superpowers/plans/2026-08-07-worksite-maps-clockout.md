# Google-Maps-Einsatzorte und robustes Arbeitsende Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einsatzorte aus Google-Maps-Links automatisch übernehmen und einen laufenden Dienst auch nach Planende bzw. außerhalb des Radius zuverlässig beenden können, während Arbeitsbeginn weiterhin strikt geogebunden bleibt.

**Architecture:** Die Maps-Link-Auswertung liegt in einem kleinen serverseitigen Helper. `schedule-v2-neon.mts` stellt dafür eine geschützte Admin-Aktion bereit. Die Zeiterfassungsregeln werden serverseitig in `attendance.mts` und `attendance-service.mts` getrennt: Start bleibt Zeitfenster+Geofence-pflichtig, Ende darf außerhalb von Zeitfenster/Geofence erfolgen und speichert den Standort nur diagnostisch. Die React-Oberfläche übernimmt die Koordinaten aus der neuen API und zeigt eine kompakte Vorschau.

**Tech Stack:** React 19, Netlify Functions, TypeScript/MTS, Netlify Identity/Blobs, Neon Attendance Repository, Node-Regressionstests.

## Global Constraints

- Keine Produktionsveröffentlichung ohne ausdrückliche Freigabe.
- Keine dauerhafte Ortung.
- `clock-in` bleibt serverseitig an veröffentlichten Dienst, Zeitfenster und Einsatzradius gebunden.
- `clock-out` bleibt nur bei laufender Arbeitszeit zulässig, darf aber außerhalb von Zeitfenster/Radius und ohne Standort erfolgen.
- Google-Link-Auflösung darf nur Google-Maps-Domains abrufen.
- Bestehende Rollen- und Pausenregeln bleiben unverändert.

---

### Task 1: Regressionstests für Zeitfenster und Geofence

**Files:**
- Create: `scripts/attendance-clockout-policy-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `clockingWindowForSchedule`, `displayAttendancePhase`, `attendanceFunctionMarkers` aus `netlify/functions/attendance.mts`; `createAttendanceService` aus `netlify/functions/_shared/attendance-service.mts`.
- Produces: Tests, die die gewünschte Trennung von Start- und Endregeln festschreiben.

- [ ] **Step 1: Write the failing test**

Der Test muss mindestens prüfen:

```js
assert.equal(displayAttendancePhase('working', schedule, afterEnd), 'working')
assert.equal(displayAttendancePhase('paused', schedule, afterEnd), 'paused')
assert.equal(clockingWindowForSchedule(schedule, afterEnd).allowed, false)
```

Zusätzlich Repository-Testdouble verwenden und prüfen:

```js
await assert.rejects(
  service.record(actor, outsideClockIn),
  (error) => error.code === 'OUTSIDE_WORKSITE',
)

const outsideClockOutResult = await service.record(actor, outsideClockOut)
assert.equal(outsideClockOutResult.event.locationStatus, 'outside')

const noLocationClockOutResult = await service.record(actor, noLocationClockOut)
assert.equal(noLocationClockOutResult.event.locationStatus, 'unavailable')
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs`
Expected: FAIL, weil `displayAttendancePhase()` außerhalb des Planfensters aktuell `blocked` liefert und der Service `clock-out` außerhalb/ohne Standort ablehnt.

- [ ] **Step 3: Register the regression test**

`package.json` in `verify:unified` um `node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs` ergänzen.

---

### Task 2: Arbeitsende serverseitig vom Planfenster entkoppeln

**Files:**
- Modify: `netlify/functions/attendance.mts`

**Interfaces:**
- Produces: `displayAttendancePhase()` lässt offene Zustände sichtbar; POST prüft das Planfenster nur noch für `clock-in`.

- [ ] **Step 1: Keep open attendance visible after planned end**

Minimalregel:

```ts
if (phase === 'working' || phase === 'paused') return phase
const window = clockingWindowForSchedule(schedule, occurredAt)
if (!window.allowed) return 'blocked'
if (phase === 'completed') return 'idle'
return phase || 'idle'
```

- [ ] **Step 2: Apply schedule-window enforcement only to clock-in**

Ersetze die bisherige `boundaryAction`-Zeitfensterprüfung durch:

```ts
if (normalized.action === 'clock-in') {
  const window = clockingWindowForSchedule(schedule, serverNow)
  if (!window.allowed) throw clockingDeniedError(window)
}
```

- [ ] **Step 3: Update source marker**

`attendanceFunctionMarkers()` muss die neue Semantik explizit abbilden, z. B. `clockOutAllowedAfterShiftEnd: true`.

- [ ] **Step 4: Run regression test**

Run: `node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs`
Expected: Zeitfensterteil PASS, Geofence-Ende weiterhin FAIL bis Task 3.

---

### Task 3: Geofence nur für Arbeitsbeginn erzwingen

**Files:**
- Modify: `netlify/functions/_shared/attendance-service.mts`

**Interfaces:**
- Produces: `clock-in` bleibt streng, `clock-out` klassifiziert Standort nur diagnostisch.

- [ ] **Step 1: Separate strict and diagnostic boundary actions**

```ts
const locationAction = payload.action === 'clock-in' || payload.action === 'clock-out'
const requiresInsideWorksite = payload.action === 'clock-in'
```

Objekt, Distanz und Klassifikation weiterhin für beide Grenzaktionen berechnen, damit `clock-out` den Standortstatus speichern kann.

- [ ] **Step 2: Restrict blocking branch to clock-in**

```ts
if (requiresInsideWorksite && classification.status !== 'inside') {
  // bestehende WORKSITE_NOT_CONFIGURED / DEVICE_LOCATION_REQUIRED / OUTSIDE_WORKSITE Fehler
}
```

- [ ] **Step 3: Preserve clock-out diagnostics**

Bei `clock-out` mit Standort außerhalb wird `locationStatus: 'outside'` gespeichert; ohne Standort `unavailable`. Das Ereignis wird nicht abgelehnt.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs`
Expected: PASS.

---

### Task 4: Google-Maps-Link sicher auswerten

**Files:**
- Create: `netlify/functions/_shared/google-maps-location.mts`
- Create: `scripts/google-maps-location-test.mjs`

**Interfaces:**
- Produces: `parseGoogleMapsCoordinates(url)` und `resolveGoogleMapsLocation(rawUrl, fetchImpl?)`.

- [ ] **Step 1: Write failing parser tests**

Mindestens diese URL-Formen:

```js
https://www.google.com/maps/@52.123456,9.654321,17z
https://www.google.com/maps?q=52.123456,9.654321
https://www.google.com/maps/place/Test/data=!3d52.123456!4d9.654321
```

Außerdem Fremdhost ablehnen und `maps.app.goo.gl` über ein Fetch-Testdouble auf eine Google-End-URL auflösen.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types scripts/google-maps-location-test.mjs`
Expected: FAIL, Helper existiert noch nicht.

- [ ] **Step 3: Implement domain allowlist and coordinate parsing**

Erlaubte Hosts mindestens:

```ts
const GOOGLE_MAP_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
])
```

Koordinaten aus `@lat,lon`, `q=lat,lon` und `!3dlat!4dlon` lesen. Kurzlinks per `fetch(..., { redirect: 'follow' })` auflösen und ausschließlich Koordinaten aus der finalen Google-URL übernehmen.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types scripts/google-maps-location-test.mjs`
Expected: PASS.

---

### Task 5: Geschützte API-Aktion für Maps-Auflösung

**Files:**
- Modify: `netlify/functions/schedule-v2-neon.mts`

**Interfaces:**
- Consumes: `resolveGoogleMapsLocation`.
- Produces: POST `action: 'object-resolve-map'` -> `{ latitude, longitude, resolvedUrl }`.

- [ ] **Step 1: Import helper and add admin-only resolver**

Nur Rollen `owner`/`admin` dürfen die Aktion verwenden.

- [ ] **Step 2: Return clear validation errors**

Ungültiger/Fremd-Link -> HTTP 400 mit verständlicher Meldung. Nicht extrahierbare Koordinaten -> HTTP 422.

- [ ] **Step 3: Make worksite address optional**

`upsertObject()` darf einen Einsatzort mit `name`, gültigen Koordinaten und leerer `address` speichern. Bestehende Datensätze bleiben unverändert lesbar.

- [ ] **Step 4: Add action route**

```ts
if (action === 'object-resolve-map') return await resolveObjectMap(current, body)
```

---

### Task 6: Admin-Oberfläche für Google-Maps-Pin und Radius

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css` (nur falls für die kompakte Vorschau nötig)
- Create/Modify: passende Quelltests unter `scripts/`

**Interfaces:**
- Consumes: `/api/schedule-v2` mit `action: 'object-resolve-map'`.
- Produces: Maps-Link-Feld, automatische Koordinatenübernahme, Radiusfeld, kompakte Vorschau.

- [ ] **Step 1: Extend worksite form state**

```js
{ id: '', name: '', address: '', mapsUrl: '', latitude: '', longitude: '', radiusMeters: 500 }
```

- [ ] **Step 2: Add resolver action**

```js
async function resolveMapLink() {
  const result = await apiJson('/api/schedule-v2', {
    method: 'POST',
    body: JSON.stringify({ action: 'object-resolve-map', url: form.mapsUrl }),
  })
  setForm((current) => ({ ...current, latitude: result.latitude, longitude: result.longitude }))
}
```

- [ ] **Step 3: Update labels and requirements**

`Adresse / Hinweis` ist optional. `Google-Maps-Link` erklärt, dass ein gesetzter Pin genügt. Radius bleibt frei editierbar.

- [ ] **Step 4: Add compact position preview**

Wenn beide Koordinaten vorhanden sind, zeige Koordinaten und eine kleine Google-Maps-Embed-/Linkvorschau, ohne die Koordinaten manuell eingeben zu müssen.

- [ ] **Step 5: Preserve existing edit behavior**

Beim Bearbeiten bestehender Einsatzorte werden Name, Adresse, Koordinaten und Radius geladen; `mapsUrl` darf leer bleiben.

---

### Task 7: Vollständige Verifikation ohne Produktionsdeploy

**Files:**
- Modify: `package.json` falls Testregistrierung fehlt

- [ ] **Step 1: Run targeted tests**

```bash
node --experimental-strip-types scripts/google-maps-location-test.mjs
node --experimental-strip-types scripts/attendance-clockout-policy-test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run portal verification**

Run: `npm run verify:unified`
Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build:frontend`
Expected: PASS.

- [ ] **Step 4: Confirm production was not changed**

Netlify production deploy ID/commit must remain unchanged during this branch work.

- [ ] **Step 5: Handoff**

Report branch name, changed behavior, test result and explicitly state that production was not published.