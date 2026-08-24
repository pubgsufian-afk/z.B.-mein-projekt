# Full Admin Reports & Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add report/daily-report/export administration to the encrypted relay and prove that every current admin-visible Habun portal capability is explicitly supported, read-only, or security-excluded, with CI preventing future unclassified capabilities.

**Architecture:** Extract report data/building and daily-report CRUD into reusable services so the relay does not simulate browser sessions or regenerate the same data repeatedly. Then create a versioned capability inventory that maps admin-visible UI actions/endpoints to typed relay actions/classifications. A build-time test scans the known admin surfaces and fails when a new API surface/action appears without registry classification. Runtime requests use only the static registry and never rescan the UI/repository.

**Tech Stack:** TypeScript/Netlify Functions, PDF-Lib, ExcelJS, Netlify Blobs/Database, Node.js 22, GitHub Actions/CI, existing Node assertion and Playwright tests.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- Complete Plans 1–3 before declaring the whole portal relay complete.
- Reports are read/export operations unless daily-report CRUD explicitly mutates data.
- Do not log report contents, employee rows, PDF/XLSX bytes, or decrypted results.
- Avoid building the same report twice within one command. Data projection/read occurs once, then requested format(s) are rendered from that snapshot.
- Binary exports must respect the encrypted-result size limit. Large PDF/XLSX outputs must use a short-retention protected artifact/file result mechanism rather than stuffing oversized bytes into the encrypted JSON result.
- Daily-report writes preserve existing owner/admin authorization, audit author/timestamps, and word limits.
- Capability inventory is build/test-time only. Normal relay requests never scan `frontend/src` or repo files.
- Every current admin-visible capability has exactly one classification: `relay-supported`, `relay-read-only`, or `excluded-security`.
- No normal admin capability may remain unclassified when the project is marked complete.

---

## Task 1: Extract reusable report data and render services

**Files:**
- Create: `netlify/functions/_shared/report-admin-service.mts`
- Modify: `netlify/functions/unified-reports-fixed.mts`
- Modify: `netlify/functions/timesheet-reports.mts`
- Modify: `netlify/functions/schedule-pdf-fixed.mts`
- Create: `scripts/report-admin-service-test.mjs`
- Modify: `scripts/report-production-v2-test.mjs`
- Modify: `scripts/report-download-contract-test.mjs`

- [ ] **Step 1: Write failing service tests**

Use pure/fake readers to prove one data load can feed multiple renderers.

```js
import assert from 'node:assert/strict'
import { createReportAdminService } from '../netlify/functions/_shared/report-admin-service.mts'

let loads = 0
const service = createReportAdminService({
  async loadUnifiedRows(input) {
    loads += 1
    return [{ employeeName: 'A', date: input.from, pauseMinutes: 30, netMinutes: 450 }]
  },
  async buildPdf(rows) { return Buffer.from('%PDF-test') },
  async buildXlsx(rows) { return Buffer.from('PK-test') },
})
const snapshot = await service.inspect({ from: '2026-08-01', to: '2026-08-24', userIds: ['u1'] })
await service.render(snapshot, 'pdf')
await service.render(snapshot, 'xlsx')
assert.equal(loads, 1)
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types scripts/report-admin-service-test.mjs
```

- [ ] **Step 3: Define report service contracts**

```ts
export type ReportAdminInput = {
  from: string
  to: string
  userIds: string[]
  scope: 'unified' | 'actual' | 'planned'
}

export type ReportAdminSnapshot = {
  input: ReportAdminInput
  rows: ReportRow[]
  counts: { rows: number; employees: number }
}
```

Expose:

- `inspect(input)` -> projected rows/counts.
- `render(snapshot, 'pdf' | 'xlsx')` -> bytes + content type + deterministic filename.
- `renderSchedulePdf(input)` using schedule rows.

Extract row-building/data-load logic from the current production endpoints while preserving watermark/company settings logic. Browser endpoints still perform their current session/origin checks and call service methods.

- [ ] **Step 4: Ensure targeted DB queries stay targeted**

Continue using `loadReportEvents(from, to, userIds)` from `_shared/report-database.mts`. When `userIds` is non-empty, SQL must keep exact placeholders rather than load-all/filter-client-side.

Schedule row reads must specify `from`/`to`; one employee selection should additionally push `employeeUserId` where the underlying schedule repository supports it.

- [ ] **Step 5: Run report tests**

```bash
node --experimental-strip-types scripts/report-admin-service-test.mjs
node scripts/report-production-v2-test.mjs
node scripts/report-download-contract-test.mjs
node scripts/timesheet-report-source-test.mjs
node scripts/schedule-pdf-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/report-admin-service.mts netlify/functions/unified-reports-fixed.mts netlify/functions/timesheet-reports.mts netlify/functions/schedule-pdf-fixed.mts scripts/report-admin-service-test.mjs scripts/report-production-v2-test.mjs scripts/report-download-contract-test.mjs
git commit -m "refactor: share report data and rendering services"
```

---

## Task 2: Add report relay adapter and efficient export handling

**Files:**
- Create: `netlify/functions/_shared/portal-admin-reports.mts`
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-report-test.mjs`

- [ ] **Step 1: Write failing adapter tests**

Cover:

- `inspect` targeted report rows/counts.
- `render-unified` pdf/xlsx.
- `render-timesheet` pdf/xlsx.
- `render-schedule-pdf`.
- reject invalid date range/format.
- same command requesting PDF+XLSX uses one data snapshot.

- [ ] **Step 2: Implement report adapter using `report-admin-service`**

Actions:

```ts
'report-inspect'
'render-unified'
'render-timesheet'
'render-schedule-pdf'
```

For small binary results, encrypted detail may carry:

```ts
{
  filename: string,
  contentType: string,
  bytesBase64: bytes.toString('base64'),
  size: bytes.length,
}
```

Only allow this when encoded result remains safely below the existing 400 KB encrypted response limit.

- [ ] **Step 3: Add protected export artifact result for large files**

Create a short-retention artifact payload path rather than weakening the 400 KB JSON guard. The OIDC workflow already uploads one encrypted JSON result; extend the result model so a report handler may return a **separately encrypted binary artifact** written to the runner artifact directory by `run-schedule-oidc-relay.mjs`.

Use AES-256-GCM with the same caller `responseKey`, but a fresh IV/tag and a metadata JSON containing filename/contentType/size. Do not place plaintext export bytes in GitHub artifacts.

Suggested encrypted file envelope:

```json
{
  "version": 1,
  "algorithm": "A256GCM",
  "kind": "portal-admin-export",
  "filename": "Habun-Stundenzettel-2026-08.pdf",
  "contentType": "application/pdf",
  "iv": "...",
  "ciphertext": "...",
  "tag": "..."
}
```

Artifact retention stays 1 day. Add a separate artifact name `habun-portal-admin-encrypted-export` only when an export exists.

- [ ] **Step 4: Register report capabilities**

Add:

- `reports.inspect` -> relay-read-only.
- `reports.unified-pdf` -> relay-read-only.
- `reports.unified-xlsx` -> relay-read-only.
- `reports.timesheet-pdf` -> relay-read-only.
- `reports.timesheet-xlsx` -> relay-read-only.
- `reports.schedule-pdf` -> relay-read-only.

These are read-only because generation does not mutate portal business data.

- [ ] **Step 5: Register reports handler in OIDC router**

Add `reports: createReportsPortalAdminHandler(context)`.

- [ ] **Step 6: Run focused tests**

```bash
node --experimental-strip-types scripts/portal-admin-report-test.mjs
node scripts/portal-admin-oidc-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/report-production-v2-test.mjs
node scripts/final-export-logo-test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/portal-admin-reports.mts netlify/functions/schedule-oidc-trigger.mts scripts/run-schedule-oidc-relay.mjs .github/workflows/schedule-oidc-publish.yml ops/portal-admin-capabilities.json scripts/portal-admin-report-test.mjs scripts/schedule-oidc-workflow-source-test.mjs
git commit -m "feat: export reports through encrypted portal relay"
```

---

## Task 3: Extract daily-report CRUD service and add relay actions

**Files:**
- Create: `netlify/functions/_shared/daily-report-admin-service.mts`
- Modify: `netlify/functions/daily-reports.mts`
- Modify: `netlify/functions/daily-reports-pdf.mts`
- Modify: `netlify/functions/_shared/portal-admin-reports.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-daily-report-test.mjs`
- Modify: `scripts/daily-report-crud-test.mjs`
- Modify: `scripts/daily-report-pdf-test.mjs`

- [ ] **Step 1: Write failing service tests**

Test create/update/delete/list using an in-memory store and deterministic actor/time.

```js
const actor = { userId: 'portal-admin-relay', fullName: 'Portal Admin Relay', role: 'owner' }
const created = await service.create({ text: 'Schicht ohne besondere Vorkommnisse.' }, actor)
assert.equal(created.authorId, actor.userId)
const updated = await service.update(created.id, { text: 'Korrigierter Bericht.' }, actor)
assert.equal(updated.updatedById, actor.userId)
await service.delete(created.id, actor)
assert.equal((await service.get(created.id)), null)
```

Also prove >1000-word report is rejected by the same validation used by the browser endpoint.

- [ ] **Step 2: Extract CRUD business logic**

Service uses `_shared/daily-report-model.mts` store/list/find helpers and `validateDailyReportText`. To avoid circular import, move `MAX_REPORT_WORDS`, `countWords`, and `validateDailyReportText` into the shared service/model module and import them from `daily-reports.mts`.

Actor contract:

```ts
export type DailyReportAdminActor = {
  userId: string
  fullName: string
  role: 'owner' | 'admin'
}
```

- [ ] **Step 3: Convert browser endpoint to thin adapter**

Keep `requirePortalRole(['owner','admin'])` and `verifyRequestOrigin` for browser writes. Derive current author name as today, pass actor to service.

- [ ] **Step 4: Add relay actions**

Register and implement:

- `reports.daily-list` -> relay-read-only.
- `reports.daily-get` -> relay-read-only.
- `reports.daily-create` -> relay-supported.
- `reports.daily-update` -> relay-supported.
- `reports.daily-delete` -> relay-supported, requires `confirm: true`.
- `reports.daily-pdf` -> relay-read-only.

Relay mutations use stable actor `{ userId:'portal-admin-relay', fullName:'Portal Admin Relay', role:'owner' }` and preserve created/updated audit fields.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types scripts/portal-admin-daily-report-test.mjs
node scripts/daily-report-crud-test.mjs
node scripts/daily-report-pdf-test.mjs
node scripts/daily-report-ui-test.mjs
node scripts/admin-overview-daily-report-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/daily-report-admin-service.mts netlify/functions/daily-reports.mts netlify/functions/daily-reports-pdf.mts netlify/functions/_shared/portal-admin-reports.mts ops/portal-admin-capabilities.json scripts/portal-admin-daily-report-test.mjs scripts/daily-report-crud-test.mjs scripts/daily-report-pdf-test.mjs
git commit -m "feat: administer daily reports through encrypted relay"
```

---

## Task 4: Build the exhaustive admin-visible capability inventory

**Files:**
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-capability-inventory.mjs`
- Create: `scripts/portal-admin-capability-inventory-test.mjs`
- Create: `docs/portal-admin-capability-matrix.md`

- [ ] **Step 1: Define the authoritative admin UI source set**

The inventory script must inspect at least these current admin surfaces:

```js
export const ADMIN_SURFACE_FILES = [
  'frontend/src/App.jsx',
  'frontend/src/AdminOverview.jsx',
  'frontend/src/TimesheetPage.jsx',
  'frontend/src/TimesheetMonthlyPage.jsx',
  'frontend/src/employee-role-management-auto.js',
  'frontend/src/admin-time-editing.js',
]
```

Do not scan generated bundles in `public/assets`.

- [ ] **Step 2: Write failing inventory tests**

Tests must:

1. Assert all main admin navigation sections are represented: `Übersicht`, `Zeiterfassung`, `Mitarbeiter`, `Dienstplan`, `Stundenzettel`, `Einsatzorte`, `Berichte`, `Einstellungen`.
2. Extract literal `/api/...` strings from the authoritative sources.
3. Apply a small explicit ignore set only for session/auth infrastructure that is not a business admin capability.
4. Assert every discovered business endpoint is referenced by at least one registry row.
5. Assert every registry row has exactly one allowed classification and unique ID.
6. Assert `relay-supported`/`relay-read-only` rows contain a typed relay domain/action.
7. Assert `excluded-security` rows include a non-empty `reason`.

Example:

```js
const classifications = new Set(['relay-supported', 'relay-read-only', 'excluded-security'])
for (const row of registry) {
  assert.ok(classifications.has(row.classification), row.id)
  if (row.classification !== 'excluded-security') {
    assert.ok(row.relay?.domain && row.relay?.action, row.id)
  } else {
    assert.ok(String(row.reason || '').trim(), row.id)
  }
}
```

- [ ] **Step 3: Inventory current multiplexed actions manually where endpoint extraction is insufficient**

Literal endpoint discovery cannot distinguish actions such as `/api/schedule-v2` `object-delete` or `/api/registrations` `update-profile`. Add explicit registry rows for every admin-visible action verified by existing UI/source tests.

At minimum inventory these current domains/surfaces:

**Übersicht**
- live attendance read.
- today's schedule read.
- daily report CRUD/PDF.

**Zeiterfassung / Stundenzettel**
- attendance live/history/state reads.
- admin time create/edit.
- timesheet PDF/XLSX.

**Mitarbeiter**
- registrations/employees list.
- update profile.
- update role.
- deactivate account.

**Dienstplan**
- list/save/update/delete/publish/copy actions currently visible to management.
- employee directory read.
- schedule PDF.

**Einsatzorte**
- list/get/save coordinates.
- resolve Google Maps location.
- delete.

**Berichte**
- unified PDF/XLSX/report data.

**Einstellungen**
- company settings.
- company/PDF logo read/set/reset.
- any distinct legacy `/api/settings` functionality still reachable in the current UI.

- [ ] **Step 4: Classify exclusions narrowly**

Do **not** classify ordinary unsupported functions as security exclusions. `excluded-security` is only valid for capabilities such as:

- password/authentication secret operations.
- owner self-downgrade/deactivation.
- secret/environment credential exposure.
- legal-hold bypass.
- arbitrary infrastructure/SQL execution.

If a normal admin-visible function is found without a relay adapter, implementation is incomplete; add the adapter instead of excluding it.

- [ ] **Step 5: Generate human-readable matrix from JSON**

`portal-admin-capability-inventory.mjs` should render `docs/portal-admin-capability-matrix.md` deterministically from the JSON registry. The matrix includes surface, capability ID, endpoint/action, classification, relay domain/action, and exclusion reason.

Never hand-edit the generated matrix.

- [ ] **Step 6: Run inventory test and fix every gap**

```bash
node scripts/portal-admin-capability-inventory-test.mjs
node scripts/portal-admin-capability-inventory.mjs --check
```

Expected: no unclassified endpoint/action and generated file current.

- [ ] **Step 7: Commit**

```bash
git add ops/portal-admin-capabilities.json scripts/portal-admin-capability-inventory.mjs scripts/portal-admin-capability-inventory-test.mjs docs/portal-admin-capability-matrix.md
git commit -m "test: inventory every admin portal capability"
```

---

## Task 5: Add CI gate so future admin capabilities cannot silently bypass the relay

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml` if present, otherwise the repository's existing verification workflow that runs `npm run verify`
- Create: `scripts/portal-admin-full-verification-test.mjs`

- [ ] **Step 1: Add `verify:portal-admin`**

Compose the focused suites from all four plans:

```json
"verify:portal-admin": "npm run verify:portal-admin-foundation && npm run verify:portal-admin-schedule-attendance && npm run verify:portal-admin-domains && node scripts/portal-admin-report-test.mjs && node scripts/portal-admin-daily-report-test.mjs && node scripts/portal-admin-capability-inventory-test.mjs && node scripts/portal-admin-capability-inventory.mjs --check"
```

- [ ] **Step 2: Add it to the normal CI verification path**

Prefer adding `npm run verify:portal-admin` to `verify:unified` or `verify:all` rather than creating a separate expensive workflow. CI should execute once per relevant code change, not duplicate all test suites in multiple jobs.

- [ ] **Step 3: Add a source test guarding runtime cost**

`portal-admin-full-verification-test.mjs` must assert:

- capability inventory script is not imported by any Netlify runtime function.
- no portal-admin runtime adapter imports `node:fs` or reads frontend files.
- OIDC trigger does not scan repo/UI.
- target directory helpers do not call a full sync as a side effect of normal reads.
- `MAX_OPERATIONS` remains bounded.
- report service does not load the same report snapshot twice for multi-format output.

- [ ] **Step 4: Run focused full-admin verification**

```bash
npm run verify:portal-admin
```

Expected: exit 0.

- [ ] **Step 5: Run complete repository verification and build**

```bash
npm run verify
npm run build
```

Expected: exit 0 for both.

- [ ] **Step 6: Run key E2E regressions**

```bash
npx playwright test \
  tests/e2e/unified-portal.spec.mjs \
  tests/e2e/employee-role-management.spec.mjs \
  tests/e2e/worksite-feature.spec.mjs \
  tests/e2e/admin-time-editing.spec.mjs
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json .github/workflows scripts/portal-admin-full-verification-test.mjs
git commit -m "ci: require complete portal admin relay coverage"
```

---

## Task 6: Final privacy, transport, and call-efficiency acceptance test

**Files:**
- Create: `scripts/portal-admin-acceptance-test.mjs`
- Modify: `docs/portal-admin-capability-matrix.md` only through generator if necessary

- [ ] **Step 1: Build an acceptance harness around the router/client planner**

Run representative commands without production writes:

1. Kwame-style history inspection/rebind/verification.
2. one monthly pause bulk update.
3. one employee profile + worksite batch.
4. one report inspection + PDF export.

Track logical relay calls.

- [ ] **Step 2: Assert sparse call budgets**

For the Kwame correction:

```js
assert.deepEqual(actions, ['inspect-employee-history', 'rebind-employee-history', 'inspect-employee-history'])
```

For monthly pause correction:

```js
assert.deepEqual(actions, ['inspect-employee-history', 'portal-batch', 'inspect-employee-history'])
```

For profile + worksite independent changes:

```js
assert.equal(batchOperations.length, 2)
assert.equal(batchRelayCalls, 1)
```

- [ ] **Step 3: Assert GitHub-visible surfaces remain private**

Source assertions:

- workflow trigger marker remains `<!-- habun-schedule-envelope-v1 -->`.
- workflow status context contains only classification/run ID.
- `run-schedule-oidc-relay.mjs` never logs envelope, decrypted payload, responseKey, employeeName/email, report contents, encryptedResult body, or public key body.
- artifacts are encrypted and retention is 1 day.

- [ ] **Step 4: Assert transport compatibility**

Run:

```bash
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/attendance-oidc-trigger-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
```

Legacy schedule commands must still pass.

- [ ] **Step 5: Run full acceptance suite**

```bash
node --experimental-strip-types scripts/portal-admin-acceptance-test.mjs
npm run verify:portal-admin
npm run verify
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add scripts/portal-admin-acceptance-test.mjs
git commit -m "test: accept full portal admin relay"
```

## Full Portal Done Criteria

The full-admin relay is not considered complete until all are true:

- Every current admin-visible business capability is present in `ops/portal-admin-capabilities.json` with exactly one valid classification.
- Every normal business capability is relay-supported or relay-read-only; security exclusions are narrow and documented.
- Employee, schedule, attendance/timesheet, worksite, company, reports/export, and daily-report actions use typed services/adapters through the encrypted PR #73 relay.
- Existing browser UI and policy regressions pass.
- Existing schedule relay commands remain backward compatible.
- No normal operation requires browser-by-browser entry, direct SQL, or a deployment.
- Capability scanning happens only in build/test, not runtime.
- Representative correction flows prove the practical sparse-call target `1 read -> 1 batch -> 1 verification`.
- `npm run verify:portal-admin`, `npm run verify`, and `npm run build` pass before completion is claimed.