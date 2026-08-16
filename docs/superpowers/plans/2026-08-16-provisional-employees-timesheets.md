# Vorläufige Mitarbeiter und Stundenzettel – Umsetzungsplan

> **Für Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Ziel:** Nicht registrierte Mitarbeiter sollen ausdrücklich als vorläufige interne Personen im Dienstplan veröffentlicht werden können, damit veröffentlichte Schichten automatisch in Stundenzettel und Monatsberichte einfließen. Registrierte Mitarbeiter behalten unverändert ihre echte Portal-Identität, Push-Funktion und persönliche Dienstplanansicht.

**Architektur:** Der bestehende Dienstplan-Assistent bleibt die einzige Publikationsgrenze. Ein opt-in Flag `allowUnregistered: true` erlaubt ausschließlich bei `not_found` den Fallback auf eine deterministische `guest:`-ID. Mehrdeutige registrierte Namen bleiben Fehler. Gast-Schichten werden nicht in `schedule_employees` als Portalnutzer aufgenommen; sie verwenden lediglich dieselben `schedule_shifts`- und `timesheet_entries`-Datensätze wie reguläre Schichten. Eine eng begrenzte Reconciliation verbindet historische Gast-IDs nur dann mit einer echten Portal-ID, wenn genau ein Gast und genau ein registrierter Mitarbeiter denselben normalisierten vollständigen Namen haben. Keine Zeiten, Pausen, Einsatzorte oder manuellen Korrekturen werden dabei verändert.

**Tech-Stack:** TypeScript/ESM in Netlify Functions, `@netlify/database`, Netlify Identity, Node `crypto`, GitHub-OIDC-Relay, Node-Testskripte, bestehende PDF/XLSX-Stundenzettel.

---

## Task 1: Reine Gast-Identitätslogik einführen

**Dateien:**
- Neu: `netlify/functions/_shared/schedule-provisional-employee.mts`
- Neu: `scripts/schedule-provisional-employee-test.mjs`

**Schritt 1 – roten Test schreiben**

Der Test importiert die neue Hilfsdatei mit `--experimental-strip-types` und prüft mindestens:

```js
assert.equal(isProvisionalEmployeeUserId('guest:abc'), true)
assert.equal(isProvisionalEmployeeUserId('real-user-id'), false)
assert.equal(provisionalEmployeeUserId('Gast Beispiel'), provisionalEmployeeUserId('  gast   beispiel  '))
assert.notEqual(provisionalEmployeeUserId('Gast Beispiel'), provisionalEmployeeUserId('Gast BeispieL Zwei'))
assert.match(provisionalEmployeeUserId('Gast Beispiel'), /^guest:[a-f0-9]{64}$/)
```

Zusätzlich prüfen, dass ein leerer Name keine Gast-ID erzeugt und dass zwei ähnlich geschriebene, aber unterschiedliche Namen nicht zusammenfallen.

**Schritt 2 – Test ausführen und Fehler bestätigen**

```bash
node --experimental-strip-types scripts/schedule-provisional-employee-test.mjs
```

Erwartung: FAIL, weil Modul/Funktionen noch fehlen.

**Schritt 3 – minimale Implementierung**

In `schedule-provisional-employee.mts`:

```ts
import { createHash } from 'node:crypto'
import { normalizeAssistantName } from './schedule-assistant-core.mts'

export const PROVISIONAL_EMPLOYEE_PREFIX = 'guest:'

export function isProvisionalEmployeeUserId(value: unknown) {
  return String(value ?? '').startsWith(PROVISIONAL_EMPLOYEE_PREFIX)
}

export function provisionalEmployeeUserId(name: unknown) {
  const normalized = normalizeAssistantName(name)
  if (!normalized) return ''
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex')
  return `${PROVISIONAL_EMPLOYEE_PREFIX}${digest}`
}
```

Die Anzeigenamen werden **nicht** aus dem Hash rekonstruiert. Der im Auftrag gelieferte, getrimmte Name bleibt `employeeName`.

**Schritt 4 – Test grün ausführen**

```bash
node --experimental-strip-types scripts/schedule-provisional-employee-test.mjs
```

Erwartung: PASS.

**Schritt 5 – committen**

```bash
git add netlify/functions/_shared/schedule-provisional-employee.mts scripts/schedule-provisional-employee-test.mjs
git commit -m "feat: add provisional schedule employee identity"
```

---

## Task 2: Dienstplan-Assistent opt-in für nicht registrierte Mitarbeiter erweitern

**Dateien:**
- Ändern: `netlify/functions/schedule-assistant.mts`
- Ändern: `scripts/schedule-assistant-source-test.mjs`
- Ändern: `scripts/schedule-assistant-management-source-test.mjs`
- Optional ergänzen: `scripts/schedule-assistant-core-test.mjs` nur falls bestehende Pure-Core-Erwartungen angepasst werden müssen

**Schritt 1 – rote Tests für das Sicherheitsverhalten schreiben**

Die Source-/Verhaltenstests müssen diese Regeln absichern:

1. Ohne `allowUnregistered: true` bleibt ein unbekannter Name `not_found`.
2. Mit `allowUnregistered: true` wird **nur** `not_found` zu einem Gast.
3. `ambiguous` erzeugt niemals einen Gast.
4. Ein registrierter Treffer hat immer Vorrang und benutzt seine echte `userId`.
5. Gast wird nicht an `syncScheduleEmployees(...)` angehängt.
6. Gast-Schicht bekommt `employeeUserId = guest:<hash>` und den gelieferten Anzeigenamen.
7. Exakte Duplikate desselben Gastes werden wie bisher erkannt.
8. Zeitkonflikte desselben Gastes werden wie bisher erkannt.

Ein robuster Source-Test soll außerdem sicherstellen, dass `publishOne` das Flag explizit erhält und nicht global aus irgendeinem Fallback ableitet.

**Schritt 2 – gezielte Tests rot ausführen**

```bash
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
```

Erwartung: mindestens die neuen Assertions FAIL.

**Schritt 3 – `publishOne` minimal erweitern**

`publishOne(...)` erhält `allowUnregistered: boolean` als expliziten Parameter. Nach `resolveAssistantEmployee(...)`:

```ts
const resolved = resolveAssistantEmployee(input.employeeName, employees)

if (resolved.status === 'ambiguous') {
  // unverändert ablehnen
}

let employee: { userId: string; fullName: string }
if (resolved.status === 'matched' && resolved.employee) {
  employee = resolved.employee
} else if (allowUnregistered && resolved.status === 'not_found') {
  const fullName = text(input.employeeName)
  const userId = provisionalEmployeeUserId(fullName)
  if (!userId) return { index, employeeName: fullName, status: 'invalid', message: 'Mitarbeitername fehlt.' }
  employee = { userId, fullName }
} else {
  return { index, employeeName: text(input.employeeName), status: 'not_found' }
}
```

Im `publish-shifts`-Handler:

```ts
const allowUnregistered = body.allowUnregistered === true
...
results.push(await publishOne(input, index, requestId, employees, worksites, allowUnregistered))
```

Die genaue Parameterreihenfolge darf an den bestehenden Stil angepasst werden.

**Schritt 4 – Audit klar kennzeichnen**

Beim `shift-published`-Audit zusätzlich nur technische Metadaten aufnehmen, z. B. `provisionalEmployee: true/false`. Keine neue Identity-/Registrierungszeile anlegen.

**Schritt 5 – bestehende Duplicate-Logik verifizieren**

`assistantPersonMatch(...)` erkennt identische Gastpersonen bereits sicher über die identische `employeeUserId`. Keine unscharfe Namenslogik für Gäste hinzufügen.

**Schritt 6 – Tests grün ausführen**

```bash
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
node --experimental-strip-types scripts/schedule-provisional-employee-test.mjs
```

Erwartung: PASS.

**Schritt 7 – committen**

```bash
git add netlify/functions/schedule-assistant.mts scripts/schedule-assistant-source-test.mjs scripts/schedule-assistant-management-source-test.mjs scripts/schedule-assistant-core-test.mjs
git commit -m "feat: publish provisional employee shifts on opt in"
```

---

## Task 3: Verschlüsselten OIDC-Relay-Vertrag um `allowUnregistered` erweitern

**Dateien:**
- Ändern: `netlify/functions/_shared/schedule-command-worker-core.mts`
- Ändern: `netlify/functions/schedule-oidc-trigger.mts`
- Ändern: `scripts/schedule-command-worker-test.mjs`
- Ändern: `scripts/schedule-command-worker-source-test.mjs`
- Ändern: `scripts/schedule-oidc-trigger-source-test.mjs`
- Prüfen: `.github/workflows/schedule-oidc-publish.yml`
- Prüfen: `scripts/run-schedule-oidc-relay.mjs`

**Schritt 1 – rote Parser-Tests hinzufügen**

Für `publish-shifts` prüfen:

```js
// true wird erhalten
assert.equal(parsed.command.allowUnregistered, true)

// fehlt -> undefined/false, also bestehendes sicheres Verhalten
assert.equal(parsedWithoutFlag.command.allowUnregistered, undefined)
```

Nicht-boolesche Werte wie `'true'` dürfen nicht still in `true` umgewandelt werden. Entweder ignorieren oder mit klarer Parser-Validierung ablehnen; bevorzugt: bei vorhandenem Nicht-Boolean den Command ablehnen.

**Schritt 2 – Test rot ausführen**

```bash
node --experimental-strip-types scripts/schedule-command-worker-test.mjs
node scripts/schedule-command-worker-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
```

**Schritt 3 – Command-Type und Parser erweitern**

In `ScheduleWorkerCommand`:

```ts
allowUnregistered?: boolean
```

Nur für `publish-shifts` übernehmen. Bestehende 100-Schichten-Grenze und 30-Minuten-Gültigkeit unverändert lassen.

**Schritt 4 – OIDC-Trigger weiterreichen**

In `assistantRequestBody(...)` beim `publish-shifts`-Fall:

```ts
return {
  action: 'publish-shifts',
  requestId: command.commandId,
  shifts: command.shifts,
  allowUnregistered: command.allowUnregistered === true,
}
```

Die verschlüsselte Envelope-Struktur selbst braucht keine kryptografische Änderung, da das zusätzliche Feld innerhalb des bereits verschlüsselten JSON liegt.

**Schritt 5 – Relay/Workflow regressionssicher prüfen**

Keine personenbezogenen Testdaten in Workflow-Dateien eintragen. Testfixtures ausschließlich mit künstlichen Namen.

**Schritt 6 – Tests grün ausführen**

```bash
node --experimental-strip-types scripts/schedule-command-worker-test.mjs
node scripts/schedule-command-worker-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
```

**Schritt 7 – committen**

```bash
git add netlify/functions/_shared/schedule-command-worker-core.mts netlify/functions/schedule-oidc-trigger.mts scripts/schedule-command-worker-test.mjs scripts/schedule-command-worker-source-test.mjs scripts/schedule-oidc-trigger-source-test.mjs
git commit -m "feat: relay provisional employee schedule flag"
```

---

## Task 4: Sichere spätere Zusammenführung von Gast- und Portal-Identität

**Dateien:**
- Neu: `netlify/functions/_shared/schedule-provisional-reconciliation.mts`
- Ändern: `netlify/functions/_shared/schedule-neon-repository.mts`
- Ändern: `netlify/functions/_shared/timesheet-repository.mts` **nur wenn** die Reconciliation nicht sinnvoll transaktional in einem gemeinsamen Helper umgesetzt werden kann
- Ändern: `netlify/functions/schedule-assistant.mts`
- Neu: `scripts/schedule-provisional-reconciliation-test.mjs`
- Ändern: `scripts/schedule-neon-source-test.mjs`
- Ändern: `scripts/timesheet-schedule-sync-test.mjs` nur für Identitäts-Rebind-Regressionsschutz, falls nötig

**Schritt 1 – Reconciliation-Regeln als rote Unit-Tests festhalten**

Mit künstlichen Mitarbeitern testen:

1. genau ein Gast + genau ein aktiver registrierter Mitarbeiter mit demselben **normalisierten vollständigen Namen** -> Merge zulässig;
2. kein registrierter Volltreffer -> kein Merge;
3. zwei registrierte Volltreffer -> kein Merge;
4. zwei verschiedene Gast-IDs für denselben normalisierten Namen -> kein automatischer Merge;
5. nur gleicher Vorname, aber anderer vollständiger Name -> kein Merge;
6. echte Portal-ID darf niemals als Gast erkannt werden.

**Schritt 2 – Tests rot ausführen**

```bash
node --experimental-strip-types scripts/schedule-provisional-reconciliation-test.mjs
```

**Schritt 3 – Pure-Core-Auswahl implementieren**

`schedule-provisional-reconciliation.mts` trennt Entscheidung von Persistenz. Eine pure Funktion, z. B.:

```ts
export function provisionalRebindCandidates(guests, registered) {
  // gruppiert beide Seiten nach normalizeAssistantName(fullName)
  // gibt nur 1:1-Vollnamens-Treffer zurück
}
```

Keine First-Name-Heuristik für historische Merges.

**Schritt 4 – Datenbank-Rebind atomar implementieren**

In einem gemeinsamen `@netlify/database`-Transaction-Kontext:

- `schedule_shifts.employee_user_id`: `guest:*` -> echte `userId`
- `schedule_shifts.employee_name`: -> kanonischer registrierter Name
- `timesheet_entries.employee_user_id`: gleiche Gast-ID -> echte `userId`
- `timesheet_entries.employee_name`: -> kanonischer registrierter Name
- **keine** Änderung an Datum, Start, Ende, Pause, Nettozeit, Tätigkeit, Einsatzort, `source`, `manual_override` oder Unterdrückungsdaten
- Audit mit Gast-ID, Ziel-ID und betroffenen Zeilenzahlen; keine sensiblen Zeitpläne als Klartext in externen Logs

Der Rebind darf keine `schedule_employees`-Gastzeile voraussetzen, weil Gäste dort absichtlich nicht angelegt werden.

**Schritt 5 – technische Gast-Liste ableiten**

Gastidentitäten werden aus vorhandenen `schedule_shifts` mit `employee_user_id LIKE 'guest:%'` abgeleitet und nach `(employee_user_id, employee_name)` dedupliziert. Kein separates Gastkonto-Schema einführen.

**Schritt 6 – Reconciliation nur an kontrollierten Schreibpunkten aufrufen**

In `schedule-assistant.mts`:

- bei `sync-directory` nach dem Laden des aktiven registrierten Verzeichnisses;
- bei `publish-shifts` vor dem Publizieren neuer Schichten.

Nicht bei jeder beliebigen Read-Anfrage Daten verändern.

Nach erfolgreichem 1:1-Rebind wird die neu registrierte Person für neue Schichten ohnehin durch `resolveAssistantEmployee` normal aufgelöst.

**Schritt 7 – Tests grün ausführen**

```bash
node --experimental-strip-types scripts/schedule-provisional-reconciliation-test.mjs
node scripts/schedule-neon-source-test.mjs
node --experimental-strip-types scripts/timesheet-schedule-sync-test.mjs
```

**Schritt 8 – committen**

```bash
git add netlify/functions/_shared/schedule-provisional-reconciliation.mts netlify/functions/_shared/schedule-neon-repository.mts netlify/functions/_shared/timesheet-repository.mts netlify/functions/schedule-assistant.mts scripts/schedule-provisional-reconciliation-test.mjs scripts/schedule-neon-source-test.mjs scripts/timesheet-schedule-sync-test.mjs
git commit -m "feat: reconcile provisional employees after registration"
```

---

## Task 5: Stundenzettel- und Monatsbericht-Verhalten für Gäste absichern

**Dateien:**
- Ändern: `scripts/timesheet-schedule-sync-test.mjs`
- Ändern: `scripts/timesheet-report-source-test.mjs`
- Prüfen, nur bei echtem Bedarf ändern: `netlify/functions/_shared/timesheet-schedule-sync.mts`
- Prüfen, nur bei echtem Bedarf ändern: `netlify/functions/timesheet-monthly-reports.mts`

**Schritt 1 – rote/ergänzende Tests schreiben**

Ein veröffentlichter Shift mit `employeeUserId: 'guest:...'` muss:

- durch `syncPublishedScheduleShift` zu einem `source: 'schedule'`-Eintrag werden;
- dieselbe Gast-ID und denselben Anzeigenamen behalten;
- `pauseMinutes` exakt übernehmen;
- `netMinutes` aus Start/Ende minus der gelieferten Pause berechnen;
- im Monatsbericht einen eigenen Mitarbeiterblock bilden.

Zusätzlich zwei verschiedene Gast-IDs müssen zwei getrennte Berichtgruppen erzeugen.

**Schritt 2 – gezielte Tests ausführen**

```bash
node --experimental-strip-types scripts/timesheet-schedule-sync-test.mjs
node scripts/timesheet-report-source-test.mjs
```

Wenn die Tests bereits mit unverändertem Produktionscode grün sind, **keine unnötige Produktivcode-Änderung** vornehmen. Das aktuelle Design der Timesheet-Synchronisierung akzeptiert bereits beliebige stabile `employeeUserId`/`employeeName`-Paare.

**Schritt 3 – nur notwendige minimale Änderung vornehmen**

Keine Sonderbehandlung wie `if guest then ...` in PDF/XLSX einbauen, solange die bestehenden generischen Gruppen funktionieren. Gäste sollen in der sichtbaren PDF nicht unnötig als „Gast“ markiert werden.

**Schritt 4 – Regressionen prüfen**

```bash
node scripts/timesheet-report-source-test.mjs
node scripts/timesheet-monthly-pdf-layout-source-test.mjs
node scripts/timesheet-monthly-excel-style-source-test.mjs
node --experimental-strip-types scripts/timesheet-schedule-sync-test.mjs
```

**Schritt 5 – committen**

```bash
git add scripts/timesheet-schedule-sync-test.mjs scripts/timesheet-report-source-test.mjs netlify/functions/_shared/timesheet-schedule-sync.mts netlify/functions/timesheet-monthly-reports.mts
git commit -m "test: cover provisional employees in timesheets"
```

Falls kein Produktionscode geändert werden musste, nur die tatsächlich veränderten Testdateien committen.

---

## Task 6: Gesamtverifikation, PR und Produktionsfreigabe

**Dateien:**
- Prüfen: `package.json`
- Alle Dateien der Tasks 1–5

**Schritt 1 – schnelle zielgerichtete Suite**

```bash
node --experimental-strip-types scripts/schedule-provisional-employee-test.mjs
node --experimental-strip-types scripts/schedule-provisional-reconciliation-test.mjs
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-assistant-management-source-test.mjs
node --experimental-strip-types scripts/schedule-command-worker-test.mjs
node scripts/schedule-command-worker-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node --experimental-strip-types scripts/timesheet-schedule-sync-test.mjs
node scripts/timesheet-report-source-test.mjs
```

Erwartung: alles PASS.

**Schritt 2 – vollständige Projektverifikation**

```bash
npm run verify:all
```

Erwartung: Exit 0. Falls bestehende Patch-/Apply-Skripte Arbeitsdateien verändern, `git status` prüfen und nur beabsichtigte Änderungen behalten; keine generierten Fremdänderungen ungeprüft committen.

**Schritt 3 – Build**

```bash
npm run build
```

Erwartung: Exit 0.

**Schritt 4 – Sicherheitskontrolle**

Vor PR:

```bash
git diff --check
git status --short
```

Manuell sicherstellen:

- `allowUnregistered` ist standardmäßig aus;
- `ambiguous` kann nie zum Gast werden;
- Gäste werden nicht in Identity/Registrierungen angelegt;
- keine Klartext-Dienstplandaten wurden in Tests, Commits oder Dokumentation aufgenommen;
- bestehende Push-Logik für echte `employeeUserId` wurde nicht verändert;
- keine Pausen werden aus Schichtdauer geraten.

**Schritt 5 – PR erstellen und CI prüfen**

PR gegen `main` mit Fokus auf:

- expliziten Gastmodus;
- Timesheet-Kompatibilität;
- sicheren 1:1-Rebind;
- keine UI-/Push-Regressionsänderung.

**Schritt 6 – nach Merge Produktionsdeploy abwarten und Smoke-Test**

Mit ausschließlich künstlichem Testnamen oder einem kontrollierten internen Testfall prüfen:

1. `allowUnregistered: false` -> unbekannt wird abgelehnt;
2. `allowUnregistered: true` -> unbekannt wird als `guest:*` veröffentlicht;
3. veröffentlichter Testshift erscheint über dieselbe Timesheet-Synchronisierung;
4. Testdaten anschließend wieder sauber löschen, sofern ein Produktions-Smoke-Test verwendet wurde.

**Schritt 7 – committen, falls nach Verifikation noch Test-/Dokuanpassungen nötig waren**

```bash
git add <nur-beabsichtigte-dateien>
git commit -m "test: verify provisional employee workflow"
```

---

## Task 7: Rückwirkende Dienstpläne sicher einspielen

**Wichtig:** Die vom Nutzer gelieferten echten Dienstplandaten bleiben außerhalb des Git-Repositories. Keine Namen, Zeiten oder kompletten Batch-Payloads als Klartext in Source-Dateien, Issues, PR-Beschreibungen oder Workflow-Kommentare committen. Für den bestehenden GitHub-Relay ausschließlich die bereits etablierte verschlüsselte Envelope verwenden und verarbeitete technische Kommentare danach neutralisieren.

**Schritt 1 – Produktionsbestand zuerst lesen**

Über den verschlüsselten Relay `list-shifts` für den rückwirkenden Zeitraum ausführen und das verschlüsselte Ergebnis prüfen. Ziel: vorhandene Schichten erkennen und keine alten Produktionsdaten blind überschreiben.

**Schritt 2 – Batch lokal/ephemer aus der freigegebenen Gesprächsquelle erstellen**

Regeln bei der Aufbereitung:

- Datum exakt aus der freigegebenen Quelle ableiten;
- `Frei` überspringen;
- unvollständige Schichten ohne Start-/Endzeit überspringen;
- zwei echte Dienste derselben Person am selben Tag als zwei Schichten behalten;
- Standard-Einsatzort verwenden, wenn kein anderer gespeicherter Einsatzort genannt ist;
- fehlenden Arbeitsbereich als `Nicht angegeben` speichern;
- `GMP` und `GMB` als denselben fachlichen Bereich behandeln;
- Pausen **explizit pro Shift mitsenden** und niemals der Serverdauer überlassen.

Verbindliche Pausenregeln für diesen Backfill:

```text
GMP/GMB                         60 Minuten
ZuKo                             0 Minuten
Reinigung/Baureinigung          30 Minuten
Bauhelfer                        30 Minuten
ZuKo + GMP/GMB                  60 Minuten
Brandwache/Brandwach             0 Minuten
sonstiger Bereich                0 Minuten, sofern keine andere Regel vorliegt
```

**Schritt 3 – registrierte Namen normal, unbekannte Namen als Gast zulassen**

Für jeden Batch:

```json
{
  "action": "publish-shifts",
  "allowUnregistered": true,
  "shifts": ["<verschlüsselt übertragen; keine Klartextdaten im Repository>"]
}
```

Der Assistent löst registrierte Mitarbeiter zuerst gegen das echte Portal-Verzeichnis auf. Nur tatsächliches `not_found` fällt auf die Gast-ID zurück.

**Schritt 4 – wegen MAX_BATCH in mehrere Relay-Aufträge teilen**

Der Rückwirkungsbestand überschreitet 100 Schichten. Deshalb mindestens zwei verschlüsselte Aufträge verwenden, jeweils **maximal 100 Schichten**. Sinnvolle Grenze ist ein sauberer Datumswechsel, damit die Verifikation leichter bleibt.

**Schritt 5 – jedes Batch-Ergebnis entschlüsseln und prüfen**

Pro Ergebnis zählen:

- `published`
- `duplicate`
- `time_conflict`
- `ambiguous`
- `invalid`
- `location_*`
- unerwartetes `not_found`

Akzeptabel sind `published` und bereits vorhandene **exakte** `duplicate`. Konflikte oder Mehrdeutigkeiten nicht automatisch überschreiben.

**Schritt 6 – Timesheet-Synchronisierung absichern**

Der OIDC-Trigger synchronisiert veröffentlichte/gefundenen Schichten anschließend mit dem Stundenzettel. Zusätzlich beim späteren Monatsbericht wird `syncPublishedScheduleRange(...)` noch einmal ausgeführt. Dadurch sollen auch Gast-Schichten zuverlässig in `timesheet_entries` landen.

**Schritt 7 – Abschlussverifikation**

Erneut verschlüsselt `list-shifts` über den gesamten rückwirkenden Zeitraum ausführen und stichprobenartig prüfen:

- registrierte Mitarbeiter tragen echte Portal-IDs;
- unregistrierte Mitarbeiter tragen `guest:*`;
- Pausen entsprechen exakt den festen Regeln;
- keine `Frei`-Zeile wurde gespeichert;
- keine unvollständige Zeile wurde erfunden;
- keine exakten Schichten doppelt angelegt.

Danach im Admin-Portal den Monats-Stundenzettel für August als PDF/XLSX erzeugen und prüfen, dass vorläufige Mitarbeiter eigene Mitarbeiterblöcke und korrekte Netto-Gesamtstunden erhalten.

**Schritt 8 – verschlüsselte Relay-Kommentare neutralisieren**

Erst **nach** erfolgreichem Workflow-Lauf und Ergebnisprüfung die technischen Kommentar-Bodies auf einen neutralen Verarbeitungshinweis zurücksetzen. Nicht vorher.

---

## Abnahmekriterien

Die Umsetzung ist erst fertig, wenn alle folgenden Punkte nachweisbar erfüllt sind:

- Unbekannte Mitarbeiter werden ohne Opt-in weiterhin abgelehnt.
- Mit `allowUnregistered: true` werden ausschließlich echte `not_found`-Namen als stabile `guest:`-Identitäten veröffentlicht.
- Registrierte Mitarbeiter werden immer unter ihrer echten Portal-ID veröffentlicht und behalten ihre Push-/Gerätefunktion.
- Mehrdeutige registrierte Namen erzeugen nie versehentlich einen Gast.
- Gast-Schichten erzeugen normale, dienstplangebundene Stundenzettel-Einträge.
- PDF/XLSX-Monatsberichte enthalten registrierte und vorläufige Mitarbeiter getrennt und vollständig.
- Ein späterer eindeutiger 1:1-Vollnamensmatch kann historische Gast-ID auf die echte Portal-ID umstellen, ohne Arbeitsdaten oder manuelle Korrekturen zu verändern.
- Rückwirkende Daten werden mit den festgelegten Pausenregeln, ohne erfundene Zeiten und ohne exakte Duplikate eingespielt.
- `npm run verify:all` und `npm run build` laufen erfolgreich.
