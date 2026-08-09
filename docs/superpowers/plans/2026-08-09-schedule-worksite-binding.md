# Automatic Schedule Worksite Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatisch veröffentlichte Schichten mit dem gespeicherten Einsatzort `Abbott Laboratories GmbH` und seiner echten `objectId` verbinden und zeitgleiche Fast-Duplikate verhindern.

**Architecture:** Die reine Kernlogik löst einen angeforderten Standort gegen die gespeicherten Portal-Einsatzorte auf und validiert ID, Koordinaten und Radius. Die bestehende Netlify Function lädt diese Einsatzorte aus `portal-schedule-v2/objects`, setzt den kanonischen Namen plus `objectId` und nutzt die vorhandene Überschneidungsabfrage für einen strengeren automatischen Duplikatschutz. OIDC-Relay, manuelle Dienstplan-API und Eincheck-Berechnung bleiben unverändert.

**Tech Stack:** Node.js 22, TypeScript/ESM, Netlify Functions, Netlify Blobs, bestehendes Neon-Repository, Node `assert`

## Global Constraints

- Standardstandort ohne ausdrückliche andere Angabe ist exakt `Abbott Laboratories GmbH`.
- Andere Standorte müssen ausdrücklich genannt, eindeutig gespeichert und vollständig für die Standortprüfung konfiguriert sein.
- Eine automatische Schicht darf nie mit `objectId: null` veröffentlicht werden.
- Gespeicherte Koordinaten und `radiusMeters` werden nicht verändert.
- Manuelles Eintragen, OIDC-Schutz, Batch-Grenze 100, Rollen und Portal-Oberfläche bleiben unverändert.
- Kein neuer öffentlicher Endpunkt und keine direkte zusätzliche Datenbankverbindung.
- Eine nicht angegebene Pause bleibt bei 0 Minuten.

---

### Task 1: Reine Einsatzort- und Zeitduplikat-Auflösung

**Files:**
- Modify: `netlify/functions/_shared/schedule-assistant-core.mts`
- Test: `scripts/schedule-assistant-core-test.mjs`

**Interfaces:**
- Consumes: angeforderter Standortname oder leerer Wert; Portal-Einsatzorte mit `id`, `name`, `latitude`, `longitude`, `radiusMeters`; Kandidat und bestehende Überschneidungen mit `start`/`end`.
- Produces: `DEFAULT_ASSISTANT_WORKSITE_NAME`, `resolveAssistantWorksite(requestedName, worksites)` und `findAssistantTimeDuplicate(candidate, overlaps)`.

- [ ] **Step 1: Failing Tests für Standard- und gespeicherten Standort schreiben**

Erweitere den Import in `scripts/schedule-assistant-core-test.mjs` um `DEFAULT_ASSISTANT_WORKSITE_NAME`, `resolveAssistantWorksite` und `findAssistantTimeDuplicate`. Ergänze:

```js
const worksites = [
  { id: 'abbott-id', name: 'Abbott Laboratories GmbH', latitude: 52.3, longitude: 9.7, radiusMeters: 500 },
  { id: 'other-id', name: 'Baustelle Nord', latitude: 52.4, longitude: 9.8, radiusMeters: 300 },
]

assert.equal(DEFAULT_ASSISTANT_WORKSITE_NAME, 'Abbott Laboratories GmbH')
assert.deepEqual(resolveAssistantWorksite('', worksites), {
  status: 'matched',
  worksite: worksites[0],
  requestedName: 'Abbott Laboratories GmbH',
})
assert.equal(resolveAssistantWorksite(' baustelle   nord ', worksites).worksite?.id, 'other-id')
assert.equal(resolveAssistantWorksite('Unbekannt', worksites).status, 'not_found')
assert.equal(resolveAssistantWorksite('Abbott Laboratories GmbH', [
  ...worksites,
  { ...worksites[0], id: 'abbott-duplicate' },
]).status, 'ambiguous')
assert.equal(resolveAssistantWorksite('Ohne GPS', [
  { id: 'no-gps', name: 'Ohne GPS', latitude: null, longitude: null, radiusMeters: 500 },
]).status, 'unconfigured')

const timeDuplicate = findAssistantTimeDuplicate(
  { start: '07:00', end: '17:00' },
  [{ id: 'existing', start: '07:00', end: '17:00', location: 'Alt', pauseMinutes: 60 }],
)
assert.equal(timeDuplicate?.id, 'existing')
```

- [ ] **Step 2: RED bestätigen**

Run:

```bash
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
```

Expected: FAIL, weil die drei neuen Exporte fehlen.

- [ ] **Step 3: Minimale reine Kernlogik implementieren**

Ergänze in `schedule-assistant-core.mts`:

```ts
export const DEFAULT_ASSISTANT_WORKSITE_NAME = 'Abbott Laboratories GmbH'

export type AssistantWorksite = {
  id?: unknown
  name?: unknown
  latitude?: unknown
  longitude?: unknown
  radiusMeters?: unknown
}

function configuredCoordinate(value: unknown, limit: number) {
  if (value == null || value === '') return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit
}

export function resolveAssistantWorksite(requestedName: unknown, worksites: AssistantWorksite[]) {
  const requested = text(requestedName) || DEFAULT_ASSISTANT_WORKSITE_NAME
  const normalized = normalizeAssistantName(requested)
  const candidates = worksites.filter((site) => normalizeAssistantName(site.name) === normalized)
  if (!candidates.length) return { status: 'not_found' as const, worksite: null, requestedName: requested }
  if (candidates.length > 1) return { status: 'ambiguous' as const, worksite: null, requestedName: requested }
  const worksite = candidates[0]
  const radius = Number(worksite.radiusMeters)
  const configured = Boolean(text(worksite.id))
    && configuredCoordinate(worksite.latitude, 90)
    && configuredCoordinate(worksite.longitude, 180)
    && worksite.radiusMeters != null && worksite.radiusMeters !== ''
    && Number.isFinite(radius) && radius >= 0 && radius <= 10_000
  if (!configured) return { status: 'unconfigured' as const, worksite: null, requestedName: requested }
  return { status: 'matched' as const, worksite, requestedName: requested }
}

export function findAssistantTimeDuplicate<T extends { start?: unknown; end?: unknown }>(
  candidate: { start?: unknown; end?: unknown },
  overlaps: T[],
) {
  return overlaps.find((entry) => text(entry.start) === text(candidate.start) && text(entry.end) === text(candidate.end)) || null
}
```

- [ ] **Step 4: GREEN bestätigen**

Run:

```bash
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
```

Expected: PASS mit `Schedule assistant core tests passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/schedule-assistant-core.mts scripts/schedule-assistant-core-test.mjs
git commit -m "feat: resolve registered schedule worksites"
```

---

### Task 2: Gespeicherte Einsatzorte in den Dienstplan-Assistenten einbinden

**Files:**
- Modify: `netlify/functions/schedule-assistant.mts`
- Test: `scripts/schedule-assistant-source-test.mjs`

**Interfaces:**
- Consumes: `resolveAssistantWorksite`, `findAssistantTimeDuplicate`, `AssistantWorksite`, Netlify-Blob-Store `portal-schedule-v2` mit Präfix `objects/`.
- Produces: `activePortalWorksites(): Promise<AssistantWorksite[]>`; veröffentlichte `ScheduleShift` mit kanonischem `location` und nichtleerer `objectId`; Ablehnungsstatus `location_not_found`, `location_ambiguous`, `location_unconfigured`.

- [ ] **Step 1: Failing Source-Vertrag schreiben**

Ergänze `scripts/schedule-assistant-source-test.mjs`:

```js
assert.match(source, /resolveAssistantWorksite/)
assert.match(source, /findAssistantTimeDuplicate/)
assert.match(source, /getStore\(\{ name: 'portal-schedule-v2'/)
assert.match(source, /list\(\{ prefix: 'objects\/' \}\)/)
assert.match(source, /location_not_found/)
assert.match(source, /location_ambiguous/)
assert.match(source, /location_unconfigured/)
assert.match(source, /objectId: text\(worksite\.id\)/)
assert.match(source, /location: text\(worksite\.name\)/)
assert.doesNotMatch(source, /objectId: null/)
```

- [ ] **Step 2: RED bestätigen**

Run:

```bash
node scripts/schedule-assistant-source-test.mjs
```

Expected: FAIL bei `resolveAssistantWorksite` oder `portal-schedule-v2`, weil der Assistent noch keine Einsatzorte lädt.

- [ ] **Step 3: Einsatzorte sicher laden**

Importiere die neuen Kernfunktionen und den Typ. Ergänze neben `activePortalEmployees`:

```ts
async function activePortalWorksites(): Promise<AssistantWorksite[]> {
  const siteStore = getStore({ name: 'portal-schedule-v2', consistency: 'strong' })
  const listed = await siteStore.list({ prefix: 'objects/' })
  const rows = await Promise.all(
    listed.blobs.map((blob) => siteStore.get(blob.key, { type: 'json' }) as Promise<AssistantWorksite | null>),
  )
  return rows.filter((row): row is AssistantWorksite => Boolean(row))
}
```

Fehler werden absichtlich nicht in eine leere Liste umgewandelt: Der bestehende äußere `catch` liefert dann 500 und verhindert jede Veröffentlichung ohne Standort-ID.

- [ ] **Step 4: Standort vor dem Speichern auflösen**

Lade die Einsatzorte einmal pro Request parallel zur Mitarbeiterliste:

```ts
const [{ employees, directoryDiagnostics }, worksites] = await Promise.all([
  activePortalEmployees(requestedNames),
  activePortalWorksites(),
])
```

Erweitere `publishOne` um `worksites: AssistantWorksite[]`. Nach der Mitarbeiterauflösung:

```ts
const worksiteResolution = resolveAssistantWorksite(input.location, worksites)
if (worksiteResolution.status !== 'matched' || !worksiteResolution.worksite) {
  const status = worksiteResolution.status === 'ambiguous'
    ? 'location_ambiguous'
    : worksiteResolution.status === 'unconfigured'
      ? 'location_unconfigured'
      : 'location_not_found'
  return {
    index,
    employeeName: employee.fullName,
    status,
  }
}
const worksite = worksiteResolution.worksite
```

Setze im Kandidaten:

```ts
objectId: text(worksite.id),
location: text(worksite.name),
```

Entferne die alte freie Standardtext-Zuweisung für `location`.

- [ ] **Step 5: Fast-Duplikate vor dem Schreiben stoppen**

Ermittle Überschneidungen vor dem bisherigen exakten Duplikatcheck:

```ts
const overlaps = await listScheduleOverlaps(candidate)
const timeDuplicate = findAssistantTimeDuplicate(candidate, overlaps)
if (timeDuplicate) {
  return {
    index,
    employeeName: employee.fullName,
    status: 'duplicate',
    shiftId: timeDuplicate.id,
  }
}
```

Behalte `findExactScheduleDuplicate` im `23505`-Catch für konkurrierende exakt gleiche Inserts. Verwende die bereits geladenen `overlaps` später als Warnungen, statt sie erneut abzufragen.

- [ ] **Step 6: Source-Test GREEN bestätigen**

Run:

```bash
node scripts/schedule-assistant-source-test.mjs
```

Expected: PASS mit `Schedule assistant source tests passed`.

- [ ] **Step 7: Kern- und bestehende Dienstplantests gemeinsam ausführen**

Run:

```bash
node --experimental-strip-types scripts/schedule-assistant-core-test.mjs
node scripts/schedule-assistant-source-test.mjs
node scripts/schedule-neon-source-test.mjs
node --experimental-strip-types scripts/schedule-command-worker-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
```

Expected: alle fünf Befehle mit Exit-Code 0.

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/schedule-assistant.mts scripts/schedule-assistant-source-test.mjs
git commit -m "fix: bind automatic shifts to saved worksite"
```

---

### Task 3: Vollständige Verifikation und einmaliger Rollout

**Files:**
- Verify: gesamtes Repository
- No further production source changes unless a failing test exposes a regression in scope

**Interfaces:**
- Consumes: Implementierung aus Tasks 1–2.
- Produces: geprüfter PR, Merge auf `main`, genau ein Production-Deploy für die Funktionsänderung.

- [ ] **Step 1: Diff und Arbeitsbaum prüfen**

Run:

```bash
git status --short
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
```

Expected: nur Spezifikation, Plan, zwei Assistent-Dateien und zwei Tests; kein Whitespace-Fehler.

- [ ] **Step 2: Vollständige Repository-Verifikation**

Run:

```bash
npm run verify
```

Expected: Exit-Code 0 und keine fehlgeschlagenen Tests.

- [ ] **Step 3: Production-Build**

Run:

```bash
npm run build
```

Expected: Exit-Code 0.

- [ ] **Step 4: E2E-Test**

Run:

```bash
npm run test:e2e
```

Expected: Exit-Code 0 und keine fehlgeschlagenen Playwright-Tests.

- [ ] **Step 5: Geprüfte Änderungen veröffentlichen**

Erstelle einen PR von `fix/schedule-worksite-binding` nach `main`. Die Beschreibung nennt:

```text
- Standardstandort Abbott Laboratories GmbH wird aus gespeicherten Einsatzorten aufgelöst
- objectId, kanonischer Name, Koordinaten- und Radiusvalidierung
- automatische Fast-Duplikate nach Mitarbeiter/Datum/Zeit verhindert
- manuelles Portal und OIDC-Relay unverändert
```

Merge erst nach grünen GitHub-Prüfungen. Der Merge löst den einmaligen Netlify-Production-Deploy aus.

- [ ] **Step 6: Deployment verifizieren**

Prüfe, dass der Production-Deploy `ready` ist, exakt den Merge-Commit enthält und die Function `schedule-assistant` veröffentlicht wurde. Ein täglicher Dienstplan darf weiterhin keinen Commit und keinen Deploy auslösen.

- [ ] **Step 7: Sicherer Live-Kontrolllauf**

Sende über PR #73 einen verschlüsselten Batch für eine bereits vorhandene Schicht am Standardstandort. Erwartung:

```text
published=0
duplicate>=1
rejected=0
```

Der Kontrolllauf darf keine neue Schicht erzeugen. Eine vorhandene Alt-Schicht ohne `objectId` wird in diesem Auftrag nicht automatisch verändert; die neue Standortbindung ist durch die Kern- und Source-Tests sowie den Production-Build nachgewiesen.

- [ ] **Step 8: Technischen Kommentar neutralisieren**

Ändere den verarbeiteten PR-Kommentar auf:

```text
Habun Dienstplan-Auftrag verarbeitet.
```

Da der Workflow nur auf `issue_comment.created` reagiert, entsteht kein zweiter Lauf.
