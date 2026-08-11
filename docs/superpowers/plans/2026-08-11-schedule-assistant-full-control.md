# Dienstplan-Assistent Full Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den geschützten Dienstplan-Assistenten so erweitern, dass ChatGPT echte Dienstpläne lesen, Dubletten erkennen, einzelne Schichten ändern und löschen kann, ohne normale Dienstplanaktionen an Production-Deploys zu koppeln.

**Architecture:** Neon Postgres bleibt zentrale Quelle für Schichten. Die bisher nur in `schedule-v2-neon.mts` enthaltene Legacy-Blob-Migration wird in eine gemeinsame Bootstrap-Funktion ausgelagert, die sowohl Browser-Dienstplan als auch technischer Assistent vor Datenzugriffen ausführen. Personenbezogene Dublettenlogik wird als pure Helper-Funktion im Assistant-Core implementiert und sowohl beim ChatGPT-Publish als auch bei Portal-Saves genutzt; schreibende Assistent-Aktionen arbeiten immer über konkrete Dienst-IDs und schreiben Audit-Einträge.

**Tech Stack:** TypeScript/ESM Netlify Functions, `@netlify/database`, `@netlify/blobs`, Netlify Identity, Node.js `assert`, bestehende GitHub/Netlify Relay-Pipeline.

## Global Constraints

- Der vorhandene `SCHEDULE_ASSISTANT_TOKEN` bleibt die Authentifizierung für den internen Dienstplan-Assistenten.
- Kein öffentlicher Verwaltungsendpunkt und kein dauerhafter Browser-Login für ChatGPT.
- Neon Postgres ist die zentrale Quelle für Dienstplan-Dienste.
- Legacy-Blob-Dienste müssen vor technischen Lese-/Schreiboperationen zuverlässig nach Neon migriert bzw. sichtbar gemacht werden.
- Änderungen und Löschungen benötigen immer eine konkrete Dienst-ID.
- Namen allein dürfen niemals direkt als Löschschlüssel verwendet werden.
- Zwei tatsächlich unterschiedliche aktive Mitarbeiter mit identischem vollständigem Namen dürfen nicht automatisch zusammengeführt werden.
- Normale Dienstplanänderungen dürfen keinen eigenen Production-Deploy auslösen.
- Bestehende Browser-Rechte für Mitarbeiter und Administratoren bleiben unverändert.
- Alle schreibenden ChatGPT-Aktionen werden als Actor `dienstplan-assistent` auditiert.

---

### Task 1: Gemeinsame Personen- und Dublettenlogik

**Files:**
- Modify: `netlify/functions/_shared/schedule-assistant-core.mts`
- Modify: `scripts/schedule-assistant-core-test.mjs`

**Interfaces:**
- Produces: `assistantPersonMatch(candidate, existing, activeEmployees)` mit Status `same | different | ambiguous`.
- Produces: `classifyAssistantDuplicate(candidate, existingShifts, activeEmployees)` mit `exact`, `time`, `overlaps` und `ambiguous` Ergebnissen.
- Consumes: bestehende `normalizeAssistantName` und Zeitfelder.

- [ ] **Step 1: Write the failing tests**

Erweitere `scripts/schedule-assistant-core-test.mjs` um Fälle für:

```js
const uniqueDirectory = [
  { userId: 'new-aras', fullName: 'Aras Khalaf', role: 'employee', status: 'active', location: 'Abbott' },
]
assert.equal(assistantPersonMatch(
  { employeeUserId: 'old-aras', employeeName: 'Aras Khalaf' },
  { employeeUserId: 'new-aras', employeeName: 'Aras Khalaf' },
  uniqueDirectory,
).status, 'same')

const duplicateNames = [
  { userId: 'a1', fullName: 'Amin Ali', role: 'employee', status: 'active' },
  { userId: 'a2', fullName: 'Amin Ali', role: 'employee', status: 'active' },
]
assert.equal(assistantPersonMatch(
  { employeeUserId: 'old', employeeName: 'Amin Ali' },
  { employeeUserId: 'a1', employeeName: 'Amin Ali' },
  duplicateNames,
).status, 'ambiguous')

const duplicateResult = classifyAssistantDuplicate(
  { employeeUserId: 'new-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  [
    { id: 'old-id', employeeUserId: 'old-aras', employeeName: 'Aras Khalaf', date: '2026-08-10', start: '06:00', end: '14:00', location: 'Abbott', workArea: 'ZuKo' },
  ],
  uniqueDirectory,
)
assert.equal(duplicateResult.exact?.id, 'old-id')
```

Zusätzlich Zeitduplikat, bloße Überschneidung und zwei gleichnamige aktive Personen testen.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types scripts/schedule-assistant-core-test.mjs`
Expected: FAIL, weil `assistantPersonMatch` und `classifyAssistantDuplicate` noch nicht exportiert sind.

- [ ] **Step 3: Implement minimal pure helpers**

Implementiere in `schedule-assistant-core.mts`:

```ts
export type AssistantPersonShift = {
  employeeUserId?: unknown
  employeeName?: unknown
  date?: unknown
  start?: unknown
  end?: unknown
  location?: unknown
  workArea?: unknown
}

export function assistantPersonMatch(
  left: AssistantPersonShift,
  right: AssistantPersonShift,
  activeEmployees: AssistantDirectoryEmployee[],
) {
  const leftId = text(left.employeeUserId)
  const rightId = text(right.employeeUserId)
  if (leftId && rightId && leftId === rightId) return { status: 'same' as const }

  const leftName = normalizeAssistantName(left.employeeName)
  const rightName = normalizeAssistantName(right.employeeName)
  if (!leftName || leftName !== rightName) return { status: 'different' as const }

  const activeSameName = activeEmployees.filter((employee) => normalizeAssistantName(employee.fullName) === leftName)
  if (activeSameName.length === 1) return { status: 'same' as const }
  if (activeSameName.length > 1) return { status: 'ambiguous' as const }
  return { status: 'different' as const }
}
```

`classifyAssistantDuplicate` prüft nur Schichten desselben Datums, verwendet `assistantPersonMatch`, klassifiziert gleiche Start/Ende + gleiche Location/WorkArea als `exact`, gleiche Start/Ende mit abweichendem Bereich/Ort als `time`, sonst echte Zeitüberschneidungen als `overlaps`. Bei `ambiguous` darf keine automatische Personen-Zusammenführung stattfinden.

- [ ] **Step 4: Run core tests**

Run: `node --experimental-strip-types scripts/schedule-assistant-core-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add schedule person duplicate classification`

---

### Task 2: Legacy-Bootstrap gemeinsam nutzbar machen

**Files:**
- Create: `netlify/functions/_shared/schedule-legacy-bootstrap.mts`
- Modify: `netlify/functions/schedule-v2-neon.mts`
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `scripts/schedule-neon-source-test.mjs`
- Modify: `scripts/schedule-assistant-source-test.mjs`

**Interfaces:**
- Produces: `ensureLegacyScheduleMigrated()` aus Shared-Modul.
- Consumes: Repository-Funktionen `hasScheduleMigration`, `markScheduleMigration`, `upsertScheduleShift`, `upsertScheduleVersion`, `writeScheduleAudit` und Blob-Store `portal-schedule-v2`.

- [ ] **Step 1: Write failing source-contract assertions**

In den Source-Tests verlangen:

```js
assert.match(source, /ensureLegacyScheduleMigrated/)
```

und in `schedule-v2-neon.mts` sicherstellen, dass keine lokale Definition `async function ensureLegacyScheduleMigrated` mehr existiert.

- [ ] **Step 2: Run targeted source tests and confirm failure**

Run: `node scripts/schedule-neon-source-test.mjs && node scripts/schedule-assistant-source-test.mjs`
Expected: FAIL wegen fehlendem Shared-Bootstrap im Assistenten.

- [ ] **Step 3: Extract the existing migration verbatim into the shared module**

Das Shared-Modul liest `shifts/` und `versions/` aus `portal-schedule-v2`, verwendet denselben `LEGACY_MIGRATION_KEY = 'portal-schedule-v2-blobs-v1'`, bewahrt die bisherige `legacy-blob` Quelle und Audit-Aktion `legacy-blob-import-complete`.

- [ ] **Step 4: Call bootstrap before assistant data actions**

Direkt nach Token/Body-Validierung und vor Directory/Data-Aktionen:

```ts
await ensureLegacyScheduleMigrated()
```

Bei Fehlern: Status 503 mit Code `SCHEDULE_DATABASE_BOOTSTRAP_FAILED`; keine geratenen Fallback-Daten.

- [ ] **Step 5: Run targeted tests**

Run: `node scripts/schedule-neon-source-test.mjs && node scripts/schedule-assistant-source-test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `refactor: share schedule legacy bootstrap`

---

### Task 3: Assistent-Lese-, Änderungs-, Lösch- und Dublettenaktionen

**Files:**
- Modify: `netlify/functions/schedule-assistant.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts`
- Modify: `scripts/schedule-assistant-source-test.mjs`
- Create: `scripts/schedule-assistant-management-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces actions: `list-shifts`, `get-shift`, `find-duplicates`, `update-shift`, `delete-shift`.
- `list-shifts` consumes optional `from`, `to`, `employeeName`, `employeeUserId`, `location`, `status` and returns normalized `entries`.
- `get-shift` consumes `shiftId`.
- `update-shift` consumes `shiftId` plus editable fields and returns verified `shift` plus `warnings`.
- `delete-shift` consumes `shiftId` and returns `{ deleted: true, id }` after audit.
- `find-duplicates` consumes `from`, `to`, optional employee filters and returns candidate pairs/classification.

- [ ] **Step 1: Write failing management source test**

`script/schedule-assistant-management-source-test.mjs` asserts all five actions, repository read/delete calls, pre-read before update/delete, audit action names `shift-updated`/`shift-deleted`, and post-update verification.

- [ ] **Step 2: Run failing test**

Run: `node scripts/schedule-assistant-management-source-test.mjs`
Expected: FAIL because actions do not exist.

- [ ] **Step 3: Add repository filtering support without bypass SQL**

Extend `listScheduleShifts` with optional `employeeName`, `location`, `status`, using parameterized clauses only. Keep existing callers compatible.

- [ ] **Step 4: Implement `list-shifts` and `get-shift`**

Validate ISO `from`/`to` if provided; reject `to < from`; cap results to existing practical schedule scope, not unbounded arbitrary dumps. `get-shift` returns `not_found` if absent.

- [ ] **Step 5: Implement `find-duplicates`**

Load active directory plus matching shifts, compare pairwise only within same date, call `classifyAssistantDuplicate`, emit exact/time/overlap candidates while not collapsing ambiguous same-name employees.

- [ ] **Step 6: Strengthen publish duplicate behavior**

Before `upsertScheduleShift`, load date shifts, call `classifyAssistantDuplicate`. Return `duplicate` for exact; `time_conflict` for same time but differing location/area; return overlap warnings otherwise. Preserve unique-index catch as concurrency defense.

- [ ] **Step 7: Implement `update-shift`**

Read existing by `shiftId`; merge only allowed fields; resolve any changed employee/worksite through existing resolvers; validate; exclude target ID from comparisons; reject exact/time conflicts; call `upsertScheduleShift`; write audit with `before`, `after`, `requestId`; re-read by ID and return verified result.

- [ ] **Step 8: Implement `delete-shift`**

Read by `shiftId`, return `not_found` when absent, then delete by ID only, audit with prior schedule summary and `requestId`, return deleted ID.

- [ ] **Step 9: Add test script to unified verification**

Append `node scripts/schedule-assistant-management-source-test.mjs` near existing schedule assistant tests in `verify:unified`.

- [ ] **Step 10: Run targeted tests**

Run:
`node --experimental-strip-types scripts/schedule-assistant-core-test.mjs && node scripts/schedule-assistant-source-test.mjs && node scripts/schedule-assistant-management-source-test.mjs && node scripts/schedule-neon-source-test.mjs`
Expected: PASS.

- [ ] **Step 11: Commit**

Commit message: `feat: add full schedule assistant management`

---

### Task 4: Portal-Dubletten-Schutz gegen alte Mitarbeiter-IDs

**Files:**
- Modify: `netlify/functions/schedule-v2-neon.mts`
- Modify: `scripts/schedule-neon-source-test.mjs`

**Interfaces:**
- Consumes: `classifyAssistantDuplicate` and active employees.
- Existing browser save response stays compatible; exact duplicate remains 409 `EXACT_DUPLICATE`; same-time person conflict gets 409 `TIME_DUPLICATE`; ordinary overlap remains warning.

- [ ] **Step 1: Add failing source assertions**

Require `classifyAssistantDuplicate` in the portal save path before `upsertScheduleShift` and require both `EXACT_DUPLICATE` and `TIME_DUPLICATE` handling.

- [ ] **Step 2: Run source test and confirm failure**

Run: `node scripts/schedule-neon-source-test.mjs`
Expected: FAIL until portal save path uses person-aware classification.

- [ ] **Step 3: Implement portal save protection**

Before save, load active employees and date shifts excluding candidate ID. Exact person-aware duplicate returns existing 409 contract. Same-time duplicate returns 409 `TIME_DUPLICATE` with conflicting shift ID. Other overlaps remain existing warnings.

- [ ] **Step 4: Run targeted test**

Run: `node scripts/schedule-neon-source-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: prevent stale-id schedule duplicates`

---

### Task 5: Encrypted command parser supports management writes and bootstrap/read triggers

**Files:**
- Modify: `netlify/functions/_shared/schedule-command-worker-core.mts`
- Modify: `netlify/functions/schedule-command-worker.mts`
- Modify: `scripts/schedule-command-worker-test.mjs`
- Modify: `scripts/schedule-command-worker-source-test.mjs`

**Interfaces:**
- Worker actions accepted: `sync-directory`, `publish-shifts`, `list-shifts`, `get-shift`, `find-duplicates`, `update-shift`, `delete-shift`.
- Command body fields are passed to `scheduleAssistant` after parser validation; max age and command ID restrictions remain.
- Existing processed-command idempotency remains.

- [ ] **Step 1: Add failing parser tests**

Add valid commands for each new action and invalid cases for missing `shiftId` on get/update/delete and invalid date ranges on list/find.

- [ ] **Step 2: Run parser test and confirm failure**

Run: `node --experimental-strip-types scripts/schedule-command-worker-test.mjs`
Expected: FAIL for new actions.

- [ ] **Step 3: Extend parser type and validation**

Keep `version: 1`, freshness checks and 100-shift cap. Add optional `from`, `to`, `employeeName`, `employeeUserId`, `location`, `status`, `shiftId`, and `changes` payload fields only where relevant.

- [ ] **Step 4: Forward validated command payload to assistant**

Worker builds body from validated command instead of only special-casing `publish-shifts`. Preserve token and internal function call. Summary logging must not print schedule row contents or secrets.

- [ ] **Step 5: Run worker tests**

Run: `node --experimental-strip-types scripts/schedule-command-worker-test.mjs && node scripts/schedule-command-worker-source-test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: extend encrypted schedule management commands`

---

### Task 6: Full verification and integration review

**Files:**
- No production code unless a verification failure reveals a scoped defect.

**Interfaces:**
- Validates all prior task outputs together.

- [ ] **Step 1: Run focused schedule tests**

Run:
`node --experimental-strip-types scripts/schedule-assistant-core-test.mjs && node scripts/schedule-assistant-source-test.mjs && node scripts/schedule-assistant-management-source-test.mjs && node scripts/schedule-neon-source-test.mjs && node --experimental-strip-types scripts/schedule-command-worker-test.mjs && node scripts/schedule-command-worker-source-test.mjs`
Expected: PASS.

- [ ] **Step 2: Run unified regression suite**

Run: `npm run verify:unified`
Expected: PASS.

- [ ] **Step 3: Run full project verification**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 4: Run production frontend build locally**

Run: `npm run build:frontend`
Expected: PASS with generated frontend output and no source mutation outside existing build behavior.

- [ ] **Step 5: Review diff for privacy and scope**

Verify no tokens, employee private data, or plaintext encrypted-command payloads are committed; no unrelated UI/theme changes; no deploy-trigger behavior added to schedule writes.

- [ ] **Step 6: Open a pull request instead of deploying directly**

Create PR from `feat/schedule-assistant-full-control` to `main` with test evidence. Do not merge until CI is green.
