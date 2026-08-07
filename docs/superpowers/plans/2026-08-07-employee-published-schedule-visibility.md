# Mitarbeiter sieht veröffentlichte Dienste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Veröffentlichte Dienste werden im Mitarbeiterkonto zuverlässig angezeigt, auch wenn die Session die stabile Login-ID nur als `id` liefert.

**Architecture:** Der bestehende serverseitige Schutz in `schedule-v2` bleibt unverändert maßgeblich: Mitarbeiter erhalten nur eigene veröffentlichte Dienste. Zusätzlich normalisiert der Session-Wrapper die Benutzer-ID auf `userId`, und das Frontend verwendet defensiv `session.userId || session.id`, damit eine alte oder abweichende Session-Antwort nicht erneut alle Dienste herausfiltert.

**Tech Stack:** React 19, Netlify Functions/TypeScript, Netlify Identity, Netlify Blobs, Node.js Assertions, Playwright

## Global Constraints

- Mitarbeiter dürfen ausschließlich eigene veröffentlichte Dienste sehen.
- Mitarbeiter dürfen keine Entwürfe sehen.
- Mitarbeiter dürfen keine Dienste anderer Mitarbeiter sehen.
- Die stabile Netlify-Identity-Benutzer-ID bleibt die technische Zuordnung; Namen sind kein Primärschlüssel.
- Bestehende Admin-, Manager- und Dienstplan-Support-Rechte bleiben unverändert.
- Keine Veröffentlichung auf Produktion ohne erneute ausdrückliche Freigabe des Nutzers.

---

### Task 1: Regression für die fehlerhafte Session-ID zuerst rot machen

**Files:**
- Create: `scripts/employee-schedule-session-id-test.mjs`
- Modify: `package.json`
- Modify: `tests/e2e/unified-portal.spec.mjs`

**Interfaces:**
- Consumes: Mitarbeiter-Session aus `/api/session` und Einträge aus `/api/schedule-v2?resource=entries`.
- Produces: Regressionstest, der eine Mitarbeiter-Session mit `id`, aber ohne `userId`, simuliert und trotzdem den eigenen veröffentlichten Dienst erwartet.

- [ ] **Step 1: Source-Regressionstest anlegen**

Erstelle `scripts/employee-schedule-session-id-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [sessionSource, appSource, scheduleSource] = await Promise.all([
  readFile('netlify/functions/session.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
])

assert.match(
  sessionSource,
  /String\(data\.userId \|\| data\.id \|\| ''\)\.trim\(\)/,
  'Mitarbeiter-Session normalisiert id noch nicht auf userId.',
)
assert.match(
  appSource,
  /String\(session\.userId \|\| session\.id \|\| ''\)/,
  'Dienstplan-Frontend besitzt noch keinen robusten Session-ID-Fallback.',
)
assert.match(
  scheduleSource,
  /entry\.employeeUserId === current\.userId && entry\.status === 'published'/,
  'Serverfilter für eigene veröffentlichte Dienste darf nicht entfernt werden.',
)

console.log('Employee schedule session-id regression tests passed')
```

- [ ] **Step 2: Source-Test in `verify:unified` aufnehmen**

Füge in `package.json` nach `node scripts/employee-schedule-compact-test.mjs` ein:

```text
node scripts/employee-schedule-session-id-test.mjs
```

Bestehende Prüfschritte dürfen nicht entfernt werden.

- [ ] **Step 3: Browser-Mock für Mitarbeiter auf `id`-only umstellen**

Im bestehenden Test-Setup von `tests/e2e/unified-portal.spec.mjs` muss der `/api/session`-Mock für die Rolle `employee` eine Antwort in dieser Form liefern:

```js
{
  id: users.employee.id,
  email: users.employee.email,
  fullName: users.employee.user_metadata.full_name,
  role: 'employee',
}
```

Für Admin/Manager/Scheduler bleiben die bisherigen Antworten unverändert.

- [ ] **Step 4: Mitarbeiter-Test um fremden veröffentlichten Dienst und eigenen Entwurf ergänzen**

Der Test `employee sees only clock and own published schedule` erhält drei Einträge im Schedule-Mock:

```js
const employeeVisibilityEntries = [
  {
    id: 'own-published',
    employeeUserId: users.employee.id,
    employeeName: 'Anna Beispiel',
    date: visibleMonday,
    start: '08:00',
    end: '16:00',
    pauseMinutes: 0,
    location: 'Abbott',
    workArea: 'ZuKo',
    status: 'published',
  },
  {
    id: 'own-draft',
    employeeUserId: users.employee.id,
    employeeName: 'Anna Beispiel',
    date: visibleMonday,
    start: '16:00',
    end: '18:00',
    pauseMinutes: 0,
    location: 'Abbott',
    workArea: 'Entwurf',
    status: 'draft',
  },
  {
    id: 'foreign-published',
    employeeUserId: 'employee-other',
    employeeName: 'Andere Person',
    date: visibleMonday,
    start: '07:00',
    end: '15:00',
    pauseMinutes: 0,
    location: 'Abbott',
    workArea: 'Fremder Dienst',
    status: 'published',
  },
]
```

Ergänze Assertions:

```js
await expect(page.getByText('08:00–16:00')).toBeVisible()
await expect(page.getByText('ZuKo')).toBeVisible()
await expect(page.getByText('Entwurf', { exact: true })).toHaveCount(0)
await expect(page.getByText('Fremder Dienst', { exact: true })).toHaveCount(0)
```

- [ ] **Step 5: Tests bewusst rot ausführen**

Run:

```bash
node scripts/employee-schedule-session-id-test.mjs
npm run test:e2e -- --grep "employee sees only clock and own published schedule"
```

Expected: FAIL, weil der Session-Wrapper noch `data.userId` ohne `data.id`-Fallback verwendet und das Frontend noch ausschließlich `session.userId` vergleicht.

- [ ] **Step 6: Commit**

```bash
git add scripts/employee-schedule-session-id-test.mjs package.json tests/e2e/unified-portal.spec.mjs
git commit -m "test: reproduce missing employee schedule from session id mismatch"
```

---

### Task 2: Session-ID serverseitig normalisieren

**Files:**
- Modify: `netlify/functions/session.mts`
- Verify compatibility: `scripts/apply-scheduler-support.mjs`

**Interfaces:**
- Consumes: Upstream-Session mit `data.userId` oder `data.id`.
- Produces: Mitarbeiter-Session mit garantiertem `userId: string` und zusätzlich `id: string` zur Rückwärtskompatibilität.

- [ ] **Step 1: Mitarbeiterzweig im Session-Wrapper ersetzen**

Ersetze den aktuellen Mitarbeiterblock durch:

```ts
if (data.role === 'employee') {
  const userId = String(data.userId || data.id || '').trim()
  if (!userId) {
    return json({ message: 'Die Mitarbeiter-ID konnte nicht geladen werden.' }, 502)
  }
  return json({
    id: userId,
    userId,
    email: data.email,
    fullName: data.fullName,
    role: 'employee',
  })
}
```

Damit ist die serverseitige Antwort eindeutig, unabhängig davon, ob das vorgelagerte System `id` oder `userId` verwendet.

- [ ] **Step 2: Scheduler-Patch-Kompatibilität prüfen**

`scripts/apply-scheduler-support.mjs` muss weiterhin genau diese beiden Marker finden:

```js
import { proxyToProductionBackend } from "./_shared/proxy.mts";
```

und:

```js
export default async (request: Request, _context: Context) => {
  const upstream
```

Die Mitarbeiter-Normalisierung darf diese Marker nicht verändern. Falls ein Marker durch Formatierung nicht mehr exakt passt, ändere ausschließlich den Marker im Patch, nicht das Verhalten.

- [ ] **Step 3: Source-Test ausführen**

Run:

```bash
node scripts/employee-schedule-session-id-test.mjs
```

Expected: Der Session-Teil PASS; der Frontend-Fallback darf bis Task 3 noch FAIL sein.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/session.mts scripts/apply-scheduler-support.mjs
git commit -m "fix: normalize employee session user id"
```

---

### Task 3: Mitarbeiterfilter im Frontend robust machen

**Files:**
- Modify: `frontend/src/App.jsx` — `SchedulePage`
- Verify compatibility: `scripts/apply-scheduler-support.mjs`

**Interfaces:**
- Consumes: `session.userId?: string`, `session.id?: string`, `entries: ScheduleEntry[]`.
- Produces: `employeeSessionUserId: string` und sichtbare Einträge nur für diese ID mit `status === 'published'`.

- [ ] **Step 1: Effektive Benutzer-ID in `SchedulePage` definieren**

Direkt nach:

```js
const management = MANAGEMENT.has(session.role)
```

ergänzen:

```js
const employeeSessionUserId = String(session.userId || session.id || '')
```

Nach Anwendung des Scheduler-Patches steht dort `SCHEDULING.has(session.role)`; die neue Zeile muss direkt danach erhalten bleiben.

- [ ] **Step 2: Sichtbarkeitsfilter umstellen**

Ersetze:

```js
entry.employeeUserId === session.userId && entry.status === 'published'
```

mit:

```js
String(entry.employeeUserId || '') === employeeSessionUserId && entry.status === 'published'
```

und ändere die `useMemo`-Dependencies von `session.userId` auf:

```js
[entries, management, employeeSessionUserId]
```

- [ ] **Step 3: Gezielte Tests ausführen**

Run:

```bash
npm run verify:unified
npm run test:e2e -- --grep "employee sees only clock and own published schedule"
```

Expected: PASS; eigener veröffentlichter Dienst sichtbar, eigener Entwurf und fremder Dienst unsichtbar.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx scripts/apply-scheduler-support.mjs
git commit -m "fix: show employee published schedule with stable login id"
```

---

### Task 4: Gesamte Rollen- und Browserregression prüfen

**Files:**
- Verify only: `netlify/functions/session.mts`
- Verify only: `netlify/functions/schedule-v2.mts`
- Verify only: `frontend/src/App.jsx`
- Verify only: `tests/e2e/unified-portal.spec.mjs`
- Verify only: `scripts/employee-access-policy-test.mjs`
- Verify only: `scripts/scheduler-support-test.mjs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: getesteter PR-/Preview-Stand ohne Produktionsfreigabe.

- [ ] **Step 1: Vollständige Source- und Policy-Prüfung**

Run:

```bash
npm run verify
```

Expected: Exit Code `0`, inklusive `Employee schedule session-id regression tests passed`, Employee-Access-Policy und Scheduler-Support-Policy.

- [ ] **Step 2: Produktionsbuild**

Run:

```bash
npm run build
```

Expected: Exit Code `0`; kein fehlender Patch-Marker.

- [ ] **Step 3: Vollständige Browser-Suite**

Run:

```bash
npm run test:e2e
```

Expected: alle Desktop-, iPhone- und Android-Fälle PASS.

- [ ] **Step 4: Spezifische Mitarbeiter-Sicherheitsassertions kontrollieren**

Der Browserlauf muss nachweislich enthalten:

```text
Eigener published Dienst: sichtbar
Eigener draft Dienst: nicht sichtbar
Fremder published Dienst: nicht sichtbar
PDF/Excel für Mitarbeiter: weiterhin nicht verfügbar
```

- [ ] **Step 5: Deploy-Preview prüfen, nicht veröffentlichen**

Auf der Netlify-Preview mit einem Test-Mitarbeiterkonto prüfen:

```text
Dienstplan öffnen -> eigener veröffentlichter Dienst sichtbar
Woche wechseln -> nur eigene veröffentlichte Dienste
Adminansicht -> unverändert
```

- [ ] **Step 6: PR mit ausdrücklichem Nicht-Veröffentlichen-Hinweis öffnen**

PR-Beschreibung:

```text
Behebt die Mitarbeiter-Dienstplanansicht: Session-ID wird auf userId normalisiert und das Frontend besitzt einen id-Fallback. Serverfilter bleibt unverändert: Mitarbeiter erhalten nur eigene veröffentlichte Dienste. Vollständige verify/build/E2E-Prüfung vor Merge. Nicht veröffentlichen ohne ausdrückliche Freigabe.
```

## Self-Review

- Spec coverage: stabile Login-ID, eigener published Dienst, keine fremden Dienste, keine Entwürfe, bestehende Rollen und keine Produktionsfreigabe sind jeweils abgedeckt.
- Placeholder scan: keine TBD/TODO/unspezifischen Testschritte.
- Type consistency: `userId`, `id`, `employeeSessionUserId` und `employeeUserId` werden durchgehend konsistent verwendet.
- Scope: keine Datenbankmigration und keine Änderung des Dienstplan-Speichers in diesem Plan; dadurch ist der aktuelle Produktionsfehler unabhängig behebbar.
