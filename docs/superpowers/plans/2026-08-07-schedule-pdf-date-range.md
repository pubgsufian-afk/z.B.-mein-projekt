# Dienstplan-PDF Von–Bis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin, Chef und Einsatzleiter können im Dienstplan einen frei wählbaren Von–Bis-Zeitraum festlegen und genau diesen Zeitraum als Dienstplan-PDF herunterladen.

**Architecture:** Die vorhandene `/api/schedule-pdf`-Route bleibt der einzige Serververtrag; sie akzeptiert bereits `from` und `to`, validiert ISO-Daten und liefert nur freigegebene Dienste. Die Änderung liegt primär im React-Dienstplan: ein explizit für `MANAGEMENT` gesperrter Zeitraum-Block steuert den bestehenden Download. Weil der Build `scheduler` per Patch ergänzt, wird der Scheduler-Patch gleichzeitig so angepasst, dass er nicht mehr von der alten einzelnen PDF-Schaltfläche abhängt.

**Tech Stack:** React, JavaScript, CSS, Netlify Functions/TypeScript, Playwright, Node.js Assertions, GitHub Actions/Netlify Deploy Preview

## Global Constraints

- Die normale Wochenansicht des Dienstplans bleibt unverändert.
- `owner`, `admin` und `manager` dürfen den Zeitraum auswählen und das Dienstplan-PDF herunterladen.
- `scheduler` / Dienstplan-Support darf weiterhin Dienstpläne bearbeiten, aber kein Dienstplan-PDF herunterladen.
- `employee` darf weiterhin kein Dienstplan-PDF herunterladen.
- Beim Öffnen der PDF-Auswahl gilt `Von = Montag der angezeigten Woche` und `Bis = Sonntag der angezeigten Woche`.
- Die Von–Bis-Auswahl ist nach dem Öffnen unabhängig von der sichtbaren Wochenansicht.
- Tage ohne freigegebenen Dienst werden nicht als leere PDF-Zeilen erzeugt.
- Auf iPhone/kleinen Displays stehen `Von`, `Bis` und der Download-Button untereinander ohne horizontalen Überlauf.
- Keine Veröffentlichung ohne erneute ausdrückliche Freigabe des Nutzers.

---

### Task 1: Browservertrag für frei wählbaren PDF-Zeitraum zuerst rot machen

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs` — `mockPortalApis()` und Test `management downloads a valid schedule PDF`

**Interfaces:**
- Consumes: bestehende Route `/api/schedule-pdf` mit JSON `{ from: string, to: string }`.
- Produces: `mockPortalApis()` liefert zusätzlich `getSchedulePdfRequests(): Array<{from?: string, to?: string}>`; `login()` gibt das API-Testobjekt zurück, damit der Test den gesendeten Zeitraum prüfen kann.

- [ ] **Step 1: PDF-Anfragen im API-Mock erfassbar machen**

Ergänze in `mockPortalApis()` direkt bei den lokalen Testzuständen:

```js
const schedulePdfRequests = []
```

Erweitere die vorhandene Route:

```js
await page.route('**/api/schedule-pdf', async (route) => {
  if (role === 'employee') {
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Mitarbeiter dürfen keinen Dienstplan als PDF herunterladen.' }),
    })
  }
  schedulePdfRequests.push(route.request().postDataJSON())
  return route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    headers: { 'Content-Disposition': 'attachment; filename="Habun-Dienstplan-Test.pdf"' },
    body: Buffer.from('%PDF-1.4\n%%EOF'),
  })
})
```

Erweitere den Rückgabewert von `mockPortalApis()`:

```js
return {
  getAttendanceEvents: () => attendanceEvents,
  getCompany: () => company,
  getSchedulePdfRequests: () => schedulePdfRequests,
}
```

Passe `login()` an, sodass es das Mock-API-Objekt zurückgibt:

```js
async function login(page, role = 'admin') {
  const user = users[role]
  await mockIdentity(page, user)
  const apis = await mockPortalApis(page, role)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await page.getByLabel('E-Mail-Adresse').fill(user.email)
  await page.getByLabel('Passwort').fill('TestPasswort123!')
  await page.getByRole('button', { name: 'Sicher anmelden' }).click()
  await expect(page.getByRole('heading', { name: role === 'employee' ? 'Stempeluhr' : 'Übersicht', exact: true })).toBeVisible()
  return apis
}
```

- [ ] **Step 2: Den bestehenden Dienstplan-PDF-Test auf Von–Bis erweitern**

Ersetze den bisherigen Testkörper durch:

```js
test('management downloads a valid schedule PDF for a selected date range', async ({ page }) => {
  const apis = await login(page, 'admin')
  await navigate(page, 'Dienstplan')

  const visibleWeek = await page.getByLabel('Woche ab').inputValue()
  await page.getByRole('button', { name: 'Dienstplan als PDF' }).click()

  await expect(page.getByLabel('Von')).toHaveValue(visibleWeek)
  await expect(page.getByLabel('Bis')).not.toHaveValue('')

  await page.getByLabel('Von').fill('2026-08-01')
  await page.getByLabel('Bis').fill('2026-08-31')

  const downloadPromise = page.waitForEvent('download', {
    predicate: (download) => /Habun-Dienstplan.*\.pdf$/i.test(download.suggestedFilename()),
  })
  await page.getByRole('button', { name: 'Dienstplan als PDF herunterladen' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  expect(apis.getSchedulePdfRequests()).toEqual([{ from: '2026-08-01', to: '2026-08-31' }])
  await expect(page.getByText(/Dienstplan wurde als PDF erstellt/i)).toBeVisible()

  await page.getByLabel('Von').fill('2026-08-31')
  await page.getByLabel('Bis').fill('2026-08-01')
  await page.getByRole('button', { name: 'Dienstplan als PDF herunterladen' }).click()
  await expect(page.getByText(/Bis.*nicht vor.*Von|Zeitraum.*ungültig/i)).toBeVisible()
  expect(apis.getSchedulePdfRequests()).toHaveLength(1)

  await expectNoHorizontalPageOverflow(page)
})
```

- [ ] **Step 3: Test gezielt ausführen und erwartetes Rot bestätigen**

Run:

```bash
npm run test:e2e -- --grep "selected date range"
```

Expected: FAIL, weil `Von`, `Bis` und `Dienstplan als PDF herunterladen` noch nicht existieren.

- [ ] **Step 4: Teständerung committen**

```bash
git add tests/e2e/unified-portal.spec.mjs
git commit -m "test: cover schedule PDF date range selection"
```

---

### Task 2: Von–Bis-Auswahl im Dienstplan implementieren

**Files:**
- Modify: `frontend/src/App.jsx` — `SchedulePage`
- Modify: `frontend/src/styles.css` — kompakter Zeitraum-Block

**Interfaces:**
- Consumes: `addDays(date, days)`, `apiBlob('/api/schedule-pdf', ...)`, `downloadBlob(blob, filename)`, `MANAGEMENT`.
- Produces: lokale Zustände `pdfRangeOpen`, `pdfFrom`, `pdfTo`; Funktionen `toggleSchedulePdfRange()` und `downloadSchedulePdf()`; sichtbare Labels `Von`, `Bis`, Button `Dienstplan als PDF herunterladen`.

- [ ] **Step 1: Lokalen PDF-Zeitraumzustand anlegen**

Direkt nach `const [notice, setNotice] = useState(null)` in `SchedulePage` ergänzen:

```js
const [pdfRangeOpen, setPdfRangeOpen] = useState(false)
const [pdfFrom, setPdfFrom] = useState(week)
const [pdfTo, setPdfTo] = useState(addDays(week, 6))
```

- [ ] **Step 2: Öffnen/Schließen des PDF-Zeitraums implementieren**

Vor `downloadSchedulePdf()` ergänzen:

```js
function toggleSchedulePdfRange() {
  if (pdfRangeOpen) {
    setPdfRangeOpen(false)
    return
  }
  setPdfFrom(week)
  setPdfTo(addDays(week, 6))
  setPdfRangeOpen(true)
  setNotice(null)
}
```

Damit wird nur beim Öffnen auf die sichtbare Woche zurückgesetzt; nachträgliche Änderungen an `Von`/`Bis` bleiben unabhängig von der Wochenansicht.

- [ ] **Step 3: Downloadfunktion auf frei gewählte Daten umstellen und vor dem Request validieren**

Ersetze `downloadSchedulePdf()` durch:

```js
async function downloadSchedulePdf() {
  setNotice(null)
  if (!pdfFrom || !pdfTo) {
    setNotice({ tone: 'error', text: 'Bitte Von und Bis auswählen.' })
    return
  }
  if (pdfTo < pdfFrom) {
    setNotice({ tone: 'error', text: 'Bis darf nicht vor Von liegen. Bitte den Zeitraum prüfen.' })
    return
  }

  setBusy('schedule-pdf')
  try {
    const { blob, filename } = await apiBlob('/api/schedule-pdf', {
      method: 'POST',
      body: JSON.stringify({ from: pdfFrom, to: pdfTo }),
    }, 'application/pdf')
    downloadBlob(blob, filename)
    setNotice({ tone: 'success', text: 'Der Dienstplan wurde als PDF erstellt.' })
  } catch (error) {
    setNotice({ tone: 'error', text: error.message })
  } finally {
    setBusy('')
  }
}
```

- [ ] **Step 4: PDF-Schaltfläche und Zeitraum-Block explizit auf MANAGEMENT beschränken**

Im Management-Werkzeugkasten bleibt `Vorwoche kopieren` unverändert. Ersetze die bisherige einzelne PDF-Schaltfläche durch:

```jsx
{MANAGEMENT.has(session.role) && <button
  className="secondary-button"
  disabled={Boolean(busy)}
  onClick={toggleSchedulePdfRange}
>
  Dienstplan als PDF
</button>}
```

Direkt unter den Management-Aktionen, noch innerhalb der `schedule-toolbar`, ergänzen:

```jsx
{MANAGEMENT.has(session.role) && pdfRangeOpen && <div className="filter-grid schedule-pdf-range">
  <label>
    Von
    <input type="date" value={pdfFrom} onChange={(event) => setPdfFrom(event.target.value)} />
  </label>
  <label>
    Bis
    <input type="date" value={pdfTo} onChange={(event) => setPdfTo(event.target.value)} />
  </label>
  <button className="primary-button" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>
    {busy === 'schedule-pdf' ? 'PDF wird erstellt …' : 'Dienstplan als PDF herunterladen'}
  </button>
</div>}
```

Wichtig: Die explizite Prüfung `MANAGEMENT.has(session.role)` bleibt erhalten, weil der Build später `management` auf `SCHEDULING` erweitert. So erhält `scheduler` keine PDF-Oberfläche.

- [ ] **Step 5: Layout für Desktop und Handy ergänzen**

In `frontend/src/styles.css` direkt bei `.filter-grid` ergänzen:

```css
.schedule-pdf-range {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
  padding: 14px 0 0;
  border-top: 1px solid var(--border-soft);
}
.schedule-pdf-range button { min-height: 48px; }
```

Im vorhandenen `@media (max-width: 680px)` ergänzen:

```css
.schedule-pdf-range { grid-template-columns: 1fr; }
.schedule-pdf-range button { width: 100%; }
```

- [ ] **Step 6: Gezielten Browsertest erneut ausführen**

```bash
npm run test:e2e -- --grep "selected date range"
```

Expected: PASS auf Desktop-, iPhone- und Android-Projekten; genau ein PDF-Request mit `{ from: '2026-08-01', to: '2026-08-31' }`; ungültiger Bereich erzeugt keinen zweiten Request.

- [ ] **Step 7: Frontendänderung committen**

```bash
git add frontend/src/App.jsx frontend/src/styles.css
git commit -m "feat: choose date range for schedule PDF"
```

---

### Task 3: Dienstplan-Support-Patch an die neue PDF-Struktur anpassen

**Files:**
- Modify: `scripts/apply-scheduler-support.mjs`
- Modify: `scripts/scheduler-support-test.mjs`

**Interfaces:**
- Consumes: explizite Frontend-Sperre `MANAGEMENT.has(session.role)` um den PDF-Bereich.
- Produces: Scheduler-Patch erweitert weiterhin Planungsrechte, verändert aber nicht mehr die PDF-Schaltfläche; Source-Test garantiert, dass `scheduler` den PDF-Bereich nicht erhält.

- [ ] **Step 1: Alten Button-spezifischen Scheduler-Patch entfernen**

Entferne aus der `frontend/src/App.jsx`-Replacement-Liste in `scripts/apply-scheduler-support.mjs` genau diesen Block:

```js
{
  from: "<button className=\"secondary-button\" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>{busy === 'schedule-pdf' ? 'PDF wird erstellt …' : 'Dienstplan als PDF'}</button>",
  to: "{MANAGEMENT.has(session.role) && <button className=\"secondary-button\" disabled={Boolean(busy)} onClick={downloadSchedulePdf}>{busy === 'schedule-pdf' ? 'PDF wird erstellt …' : 'Dienstplan als PDF'}</button>}",
},
```

Begründung: Der neue Frontend-Code enthält die `MANAGEMENT`-Sperre bereits nativ. Der Patch darf nicht mehr von einem veralteten exakten Button-String abhängen.

- [ ] **Step 2: Scheduler-Policy-Test auf den gesamten PDF-Bereich umstellen**

Ersetze in `scripts/scheduler-support-test.mjs`:

```js
assert.match(app, /MANAGEMENT\.has\(session\.role\) && <button[^>]+onClick=\{downloadSchedulePdf\}/)
```

mit:

```js
assert.match(app, /MANAGEMENT\.has\(session\.role\) && pdfRangeOpen/)
assert.match(app, /Dienstplan als PDF herunterladen/)
assert.match(app, /JSON\.stringify\(\{ from: pdfFrom, to: pdfTo \}\)/)
```

Die bestehende Backend-Prüfung bleibt unverändert:

```js
assert.doesNotMatch(schedulePdf, /scheduler/)
```

- [ ] **Step 3: Unified-Source-Prüfung ausführen**

```bash
npm run verify:unified
```

Expected: PASS; `apply-scheduler-support.mjs` läuft ohne fehlenden Marker; `scheduler-support-test.mjs` bestätigt weiterhin keine PDF-Berechtigung für Scheduler.

- [ ] **Step 4: Browser-Scheduler-Fall gezielt ausführen**

Da der Scheduler-Test erst von `apply-scheduler-support.mjs` in die E2E-Datei eingefügt wird, zuerst vorbereiten und dann testen:

```bash
npm run verify:unified
npm run test:e2e -- --grep "scheduler edits only the schedule"
```

Expected: PASS auf Desktop, iPhone und Android; `Dienstplan als PDF` hat für `scheduler` weiterhin Count `0`.

- [ ] **Step 5: Patch- und Policy-Änderung committen**

```bash
git add scripts/apply-scheduler-support.mjs scripts/scheduler-support-test.mjs
git commit -m "fix: keep scheduler outside schedule PDF range"
```

---

### Task 4: Vollständige Regression und Vorschau-Freigabe durchführen

**Files:**
- Verify only: `netlify/functions/schedule-pdf-fixed.mts`
- Verify only: `frontend/src/App.jsx`
- Verify only: `frontend/src/styles.css`
- Verify only: `tests/e2e/unified-portal.spec.mjs`
- Verify only: `scripts/apply-scheduler-support.mjs`
- Verify only: `scripts/scheduler-support-test.mjs`

**Interfaces:**
- Consumes: alle vorherigen Tasks.
- Produces: geprüfter, nicht veröffentlichter PR-Stand mit grüner GitHub-CI und grünen Netlify Deploy Previews.

- [ ] **Step 1: Gesamte Quell-, Rollen-, PDF/Excel- und Datenbankprüfung ausführen**

```bash
npm run verify
```

Expected: PASS inklusive `Company settings tests passed`, `PDF, Excel and report query tests passed`, `Schedule PDF tests passed`, `Scheduler support policy tests passed` und `Netlify database configuration test passed`.

- [ ] **Step 2: Produktionsbuild ausführen**

```bash
npm run build
```

Expected: Exit Code `0`; Frontend-Bundle wird erstellt; keine fehlenden Patch-Marker.

- [ ] **Step 3: Vollständige Browser-Suite ausführen**

```bash
npm run test:e2e
```

Expected: alle Tests auf `desktop-chromium`, `iphone-chromium` und `android-chromium` bestehen. Insbesondere:

- Registrierung
- Admin-Einstellungen
- Ein-/Ausstempeln und Pause
- Dienstplan-Editor
- Dienstplan-PDF mit Von–Bis
- Berichts-PDF-Vorschau, PDF und Excel
- Dienstplan-Support ohne PDF
- Mitarbeiter nur mit Stempeluhr und eigenem Dienstplan
- kein horizontaler Überlauf auf Handygrößen

- [ ] **Step 4: Backendvertrag unverändert verifizieren**

Prüfe in `netlify/functions/schedule-pdf-fixed.mts`, dass weiterhin gilt:

```ts
if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) {
  return json({ message: 'Der Zeitraum ist ungültig.' }, 400)
}
```

und:

```ts
const entries = (Array.isArray(payload.entries) ? payload.entries : [])
  .filter((entry) => entry.status === 'published')
```

Expected: keine Backendänderung nötig, sofern diese Bedingungen unverändert vorhanden sind.

- [ ] **Step 5: PR-Checks und beide Netlify Deploy Previews prüfen**

Für den aktuellen Head-Commit müssen folgende Checks erfolgreich sein:

```text
Unified portal verification: success
netlify/habun-mitarbeiterportal/deploy-preview: success
netlify/calm-mousse-c6caa7/deploy-preview: success
```

- [ ] **Step 6: PR-Beschreibung mit Prüfstand ergänzen, aber PR als Draft lassen**

Die Beschreibung muss festhalten:

```text
Dienstplan-PDF unterstützt jetzt frei wählbares Von/Bis-Datum. Geprüft mit vollständigem verify/build sowie Browser-Suite auf Desktop, iPhone und Android. Dienstplan-Support und Mitarbeiter behalten kein PDF-Recht. Nicht veröffentlichen ohne ausdrückliche Freigabe.
```

- [ ] **Step 7: Abschlusscommit nur falls durch die Prüfungen noch Test-/Dokumentationsdateien geändert wurden**

```bash
git add tests/e2e/unified-portal.spec.mjs docs/superpowers/specs/2026-08-07-schedule-pdf-date-range-design.md docs/superpowers/plans/2026-08-07-schedule-pdf-date-range.md
git commit -m "docs: finalize schedule PDF range verification"
```

Wenn `git status --short` leer ist, keinen leeren Commit erzeugen.

## Self-Review

- Spec coverage: Von/Bis-Auswahl, Standardwoche, unabhängige Auswahl, Rollen, mobile Darstellung, Validierung, vorhandener Backendvertrag, nur freigegebene Dienste und vollständige Regression sind jeweils einem Task zugeordnet.
- Placeholder scan: keine `TBD`, `TODO` oder offenen Implementierungsstellen im Plan.
- Type/name consistency: Frontend und Test verwenden durchgehend `pdfRangeOpen`, `pdfFrom`, `pdfTo`, `getSchedulePdfRequests()` und `/api/schedule-pdf`.
- Scope: keine unnötige neue API, Datenbank oder PDF-Engine; bestehender Serververtrag wird wiederverwendet.
