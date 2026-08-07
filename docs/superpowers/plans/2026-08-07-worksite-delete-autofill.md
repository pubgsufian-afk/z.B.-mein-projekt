# Einsatzorte löschen und automatisch übernehmen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chef und Admin können gespeicherte Einsatzorte sicher löschen; alte Dienstpläne behalten ihren historischen Ortsnamen, und beim Auswählen eines gespeicherten Einsatzortes im Dienstplan wird dessen Name automatisch in „Bezeichnung des Einsatzortes“ übernommen.

**Architecture:** Die bestehende `schedule-v2`-Funktion erhält eine neue Aktion `object-delete`, die ausschließlich `owner` und `admin` ausführen dürfen und nur den Schlüssel `objects/<id>` löscht. Vorhandene Schichten werden nicht verändert, weil jeder Dienst `location` bereits als eigenen Text speichert. Im React-Frontend werden gespeicherte Einsatzorte mit getrennten Bearbeiten-/Löschen-Aktionen dargestellt; die Dienstplan-Auswahl synchronisiert `objectId` und `location` in einem einzigen Handler.

**Tech Stack:** React, JavaScript, CSS, Netlify Functions/TypeScript, Netlify Blobs, Playwright, Node.js Assertions

## Global Constraints

- Nur `owner` und `admin` dürfen Einsatzorte löschen.
- `manager`, `scheduler` und `employee` erhalten keine Löschberechtigung.
- Vor dem Löschen muss eine Bestätigung angezeigt werden.
- Das Löschen entfernt nur den gespeicherten Einsatzort für zukünftige Auswahl.
- Bereits gespeicherte Dienstpläne und historische Schichten bleiben unverändert und behalten `location`.
- Wird im Dienstplan ein gespeicherter Einsatzort ausgewählt, wird sein Name automatisch in `Bezeichnung des Einsatzortes` übernommen.
- Bei Auswahl von `Ohne gespeicherten Einsatzort` wird das Ortsfeld wieder frei zur manuellen Eingabe.
- Die mobile Ansicht darf keinen horizontalen Überlauf bekommen.
- Keine Veröffentlichung ohne erneute ausdrückliche Freigabe des Nutzers.

---

### Task 1: Löschvertrag und Autofill zuerst mit Tests absichern

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Create: `scripts/worksite-delete-policy-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces API action: `{ action: 'object-delete', id: string }`.
- Produces UI behavior: Auswahl eines Objekt-IDs setzt gleichzeitig `form.objectId` und `form.location`.

- [ ] **Step 1: Playwright-Mock für löschbare Einsatzorte vorbereiten**

Ändere im Mock die Objektliste so, dass sie mutierbar bleibt:

```js
const objects = [
  { id: 'site-nord', name: 'Objekt Nord', address: 'Musterstraße 1, Hannover', latitude: 52.375, longitude: 9.732, radiusMeters: 500 },
  { id: 'site-sued', name: 'Objekt Süd', address: 'Musterstraße 2, Hannover', latitude: 52.376, longitude: 9.733, radiusMeters: 500 },
]
```

Erweitere den `POST /api/schedule-v2`-Mock vor dem generischen Erfolgsfall:

```js
if (body.action === 'object-delete') {
  const index = objects.findIndex((object) => object.id === body.id)
  if (index < 0) {
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Einsatzort nicht gefunden.' }) })
  }
  objects.splice(index, 1)
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true, id: body.id }) })
}
```

- [ ] **Step 2: Failing Browser-Test für Autofill und Löschen schreiben**

Ergänze in `tests/e2e/unified-portal.spec.mjs`:

```js
test('admin auto-fills a saved worksite and can delete it without changing old shifts', async ({ page }) => {
  await login(page, 'admin')

  await navigate(page, 'Dienstplan')
  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()
  await page.getByLabel('Einsatzort').selectOption('site-nord')
  await expect(page.getByLabel('Bezeichnung des Einsatzortes')).toHaveValue('Objekt Nord')
  await page.getByRole('button', { name: 'Abbrechen' }).click()

  await navigate(page, 'Einsatzorte')
  await expect(page.getByText('Objekt Nord', { exact: true })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Objekt Nord löschen' }).click()
  await expect(page.getByText('Objekt Nord', { exact: true })).toHaveCount(0)

  await navigate(page, 'Dienstplan')
  await expect(page.getByText('Objekt Nord', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: /Dienst am .* hinzufügen/ }).first().click()
  await expect(page.getByLabel('Einsatzort').locator('option[value="site-nord"]')).toHaveCount(0)
  await expectNoHorizontalPageOverflow(page)
})
```

Der letzte Dienstplan-Check beweist gleichzeitig: Der gespeicherte Ort ist weg, aber eine schon bestehende Schicht mit `location: 'Objekt Nord'` bleibt sichtbar.

- [ ] **Step 3: Failing Server-Policy-Test erstellen**

Erstelle `scripts/worksite-delete-policy-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, app] = await Promise.all([
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])

assert.match(schedule, /action === 'object-delete'/)
assert.match(schedule, /Nur die Administration darf Einsatzorte löschen/)
assert.match(schedule, /store\(\)\.delete\(`objects\/\$\{id\}`\)/)
assert.doesNotMatch(schedule, /object-delete[\s\S]{0,1200}shifts\//)
assert.match(app, /Einsatzort löschen/)
assert.match(app, /Bezeichnung des Einsatzortes/)

console.log('Worksite delete and autofill policy tests passed')
```

- [ ] **Step 4: Test bewusst rot ausführen**

Run:

```bash
node scripts/worksite-delete-policy-test.mjs
npx playwright test tests/e2e/unified-portal.spec.mjs --grep "auto-fills a saved worksite"
```

Expected: FAIL, weil `object-delete`, Löschbutton und Autofill noch fehlen.

- [ ] **Step 5: Policy-Test in `npm run verify` aufnehmen**

Erweitere den bestehenden `verify`-Befehl in `package.json` um:

```text
node scripts/worksite-delete-policy-test.mjs
```

ohne bestehende Prüfschritte zu entfernen.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/unified-portal.spec.mjs scripts/worksite-delete-policy-test.mjs package.json
git commit -m "test: Einsatzort löschen und Autofill absichern"
```

---

### Task 2: Einsatzort serverseitig sicher löschen

**Files:**
- Modify: `netlify/functions/schedule-v2.mts`

**Interfaces:**
- Consumes POST body `{ action: 'object-delete', id: string }`.
- Produces `200 { deleted: true, id }`, `400` bei fehlender ID, `403` ohne Adminrecht und `404` bei unbekannter ID.
- Verändert ausschließlich `objects/<id>`; keine Schichten werden umgeschrieben.

- [ ] **Step 1: Löschfunktion ergänzen**

Füge neben `upsertObject()` ein:

```ts
async function deleteObject(current: NonNullable<Awaited<ReturnType<typeof actor>>>, body: Record<string, unknown>) {
  if (!['owner', 'admin'].includes(current.role)) {
    return json({ message: 'Nur die Administration darf Einsatzorte löschen.' }, 403)
  }
  const id = String(body.id || '').trim()
  if (!id) return json({ message: 'Der Einsatzort fehlt.' }, 400)

  const key = `objects/${id}`
  const existing = await store().get(key, { type: 'json' }) as WorkSite | null
  if (!existing) return json({ message: 'Der Einsatzort wurde nicht gefunden.' }, 404)

  await store().delete(key)
  return json({ deleted: true, id })
}
```

- [ ] **Step 2: POST-Aktion verdrahten**

Direkt nach `object-upsert` ergänzen:

```ts
if (action === 'object-delete') return await deleteObject(current, body)
```

- [ ] **Step 3: Policy-Test ausführen**

Run:

```bash
node scripts/worksite-delete-policy-test.mjs
```

Expected: Backend-Assertions PASS; Frontend-Assertions dürfen bis Task 3 noch FAIL sein.

- [ ] **Step 4: Bestehende Rollenlogik kontrollieren**

Verifiziere, dass `deleteObject()` ausdrücklich `['owner', 'admin']` verwendet und nicht `MANAGEMENT` oder `SCHEDULING`. Dadurch kann der Build-Patch für `scheduler` diese Berechtigung nicht versehentlich erweitern.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/schedule-v2.mts
git commit -m "feat: gespeicherte Einsatzorte sicher löschen"
```

---

### Task 3: Ortsname im Dienstplan automatisch übernehmen

**Files:**
- Modify: `frontend/src/App.jsx` — `SchedulePage`
- Modify: `scripts/apply-scheduler-support.mjs`

**Interfaces:**
- Consumes `objects: Array<{ id, name, ... }>`.
- Produces `form.objectId` und `form.location` synchron.

- [ ] **Step 1: Auswahl-Handler in `SchedulePage` ergänzen**

Direkt neben `update()` ergänzen:

```js
function selectScheduleObject(event) {
  const objectId = event.target.value
  const object = objects.find((item) => item.id === objectId)
  setForm((current) => ({
    ...current,
    objectId,
    location: object ? object.name : '',
  }))
}
```

- [ ] **Step 2: Einsatzort-Select auf den neuen Handler umstellen**

Ändere:

```jsx
<select value={form.objectId} onChange={update('objectId')}>
```

zu:

```jsx
<select value={form.objectId} onChange={selectScheduleObject}>
```

Damit ist bei `site-nord` sofort `location = 'Objekt Nord'`. Bei leerer Auswahl wird `location = ''`, sodass die manuelle Bezeichnung wieder frei eingegeben werden kann.

- [ ] **Step 3: Scheduler-Build-Patch robust halten**

Prüfe `scripts/apply-scheduler-support.mjs`: Der Patch darf weiterhin nur die Objektquelle (`/api/schedule-directory` statt `/api/registrations`) und Scheduler-Rechte ändern. Er darf den neuen `selectScheduleObject`-Handler nicht überschreiben. Falls ein exakter Marker den geänderten JSX-Block umfasst, aktualisiere nur diesen Marker auf die neue `onChange={selectScheduleObject}`-Fassung.

- [ ] **Step 4: Failing Browser-Test erneut ausführen**

Run:

```bash
npx playwright test tests/e2e/unified-portal.spec.mjs --grep "auto-fills a saved worksite"
```

Expected: Autofill-Teil PASS; Löschen kann bis Task 4 im UI noch FAIL sein.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx scripts/apply-scheduler-support.mjs
git commit -m "fix: Einsatzortname im Dienstplan automatisch übernehmen"
```

---

### Task 4: Löschbutton in der Einsatzortverwaltung ergänzen

**Files:**
- Modify: `frontend/src/App.jsx` — `WorksitesPage`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Calls POST `/api/schedule-v2` with `{ action: 'object-delete', id }`.
- Reloads object list after success.

- [ ] **Step 1: Löschfunktion in `WorksitesPage` ergänzen**

Füge ein:

```js
async function removeObject(object) {
  if (!window.confirm(`Einsatzort „${object.name}“ wirklich löschen? Alte Dienstpläne bleiben unverändert.`)) return
  setBusy(`delete:${object.id}`)
  try {
    await apiJson('/api/schedule-v2', {
      method: 'POST',
      body: JSON.stringify({ action: 'object-delete', id: object.id }),
    })
    if (form.id === object.id) {
      setForm({ id: '', name: '', address: '', latitude: '', longitude: '', radiusMeters: 500 })
    }
    setNotice({ tone: 'success', text: 'Der Einsatzort wurde gelöscht. Alte Dienstpläne bleiben unverändert.' })
    await load()
  } catch (error) {
    setNotice({ tone: 'error', text: error.message })
  } finally {
    setBusy(false)
  }
}
```

- [ ] **Step 2: Kartenstruktur in Bearbeiten + Löschen teilen**

Ersetze den bisherigen einzigen `button.worksite-card` pro Objekt durch:

```jsx
<article className="worksite-card" key={object.id}>
  <button
    type="button"
    className="worksite-card-main"
    onClick={() => setForm({
      id: object.id,
      name: object.name,
      address: object.address,
      latitude: object.latitude ?? '',
      longitude: object.longitude ?? '',
      radiusMeters: object.radiusMeters ?? 500,
    })}
  >
    <div><strong>{object.name}</strong><span>{object.address}</span></div>
    <div><strong>{object.radiusMeters || 500} m</strong><span>Prüfradius</span></div>
  </button>
  <button
    type="button"
    className="danger-outline compact worksite-delete"
    aria-label={`${object.name} löschen`}
    disabled={busy === `delete:${object.id}`}
    onClick={() => removeObject(object)}
  >
    {busy === `delete:${object.id}` ? 'Wird gelöscht …' : 'Löschen'}
  </button>
</article>
```

- [ ] **Step 3: Mobile CSS ergänzen**

Füge in `frontend/src/styles.css` gezielte Regeln hinzu:

```css
.worksite-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: stretch; }
.worksite-card-main { min-width: 0; width: 100%; display: flex; justify-content: space-between; gap: 16px; border: 0; background: transparent; color: inherit; text-align: left; }
.worksite-delete { align-self: center; }

@media (max-width: 680px) {
  .worksite-card { grid-template-columns: 1fr; }
  .worksite-card-main { align-items: stretch; flex-direction: column; }
  .worksite-card-main > div:last-child { text-align: left; }
  .worksite-delete { width: 100%; }
}
```

Passe vorhandene `.worksite-card`-Regeln an, damit keine widersprüchlichen Button-Stile übrig bleiben.

- [ ] **Step 4: Browser-Test ausführen**

Run:

```bash
npx playwright test tests/e2e/unified-portal.spec.mjs --grep "auto-fills a saved worksite"
```

Expected: PASS.

- [ ] **Step 5: Policy-Test ausführen**

Run:

```bash
node scripts/worksite-delete-policy-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/styles.css
git commit -m "feat: Einsatzorte aus der Verwaltung löschen"
```

---

### Task 5: Rechte, Historie und vollständige Portalregression prüfen

**Files:**
- Modify if necessary: `tests/e2e/unified-portal.spec.mjs`
- Modify if necessary: `scripts/scheduler-support-test.mjs`

**Interfaces:**
- No new production interface; this task verifies the complete behavior.

- [ ] **Step 1: Rechte im Browser bestätigen**

Ergänze/prüfe Assertions:

```js
await login(page, 'employee')
await expect(page.getByRole('button', { name: /löschen/i })).toHaveCount(0)
```

Der bestehende Scheduler-Test muss weiterhin zeigen, dass `Einsatzorte` überhaupt nicht in seiner Navigation vorhanden ist.

- [ ] **Step 2: Alte Schicht nach Objektlöschung explizit prüfen**

Im Admin-Test muss nach dem Löschen weiterhin eine bereits existierende Schicht mit `location: 'Objekt Nord'` sichtbar sein. Es darf keine API-Aktion geben, die `shifts/` wegen `object-delete` ändert.

- [ ] **Step 3: Vollständige Quell-/Policy-Prüfung ausführen**

Run:

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 4: Produktionsbuild prüfen**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Vollständigen Browserlauf ausführen**

Run:

```bash
npm run test:e2e
```

Expected: alle Desktop-, iPhone- und Android-Fälle PASS.

- [ ] **Step 6: Vorschau prüfen**

Auf der Netlify-Deploy-Preview kontrollieren:

1. gespeicherten Einsatzort im Diensteditor auswählen → Ortsbezeichnung füllt sich automatisch;
2. Einsatzortverwaltung öffnen → Bearbeiten und Löschen sind getrennte Aktionen;
3. Löschen abbrechen → nichts ändert sich;
4. Löschen bestätigen → Ort verschwindet aus der gespeicherten Liste;
5. alte Dienstplanzeile mit diesem Ortsnamen bleibt sichtbar;
6. neuer Dienst kann den gelöschten Ort nicht mehr auswählen;
7. iPhone-Ansicht hat keinen horizontalen Überlauf.

- [ ] **Step 7: Keine Produktionsfreigabe**

PR/Preview bleibt ungemerged, bis der Nutzer ausdrücklich die Veröffentlichung freigibt.

- [ ] **Step 8: Abschlusscommit nur falls Testanpassungen nötig waren**

```bash
git add tests/e2e/unified-portal.spec.mjs scripts/scheduler-support-test.mjs
git commit -m "test: Einsatzortlöschung vollständig regressionsprüfen"
```
