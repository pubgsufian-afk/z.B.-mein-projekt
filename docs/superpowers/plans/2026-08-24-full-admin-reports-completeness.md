# Full Admin Reports & Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add report/daily-report/export administration to the encrypted relay and prove that every current admin-visible Habun portal capability is explicitly supported, read-only, or security-excluded, with CI preventing future unclassified capabilities.

**Architecture:** Extract report data/building and daily-report CRUD into reusable services. Small report results remain in the normal encrypted response. Large PDF/XLSX results are encrypted inside Netlify, placed briefly in an encrypted export spool under an opaque handle, pulled once by the existing OIDC runner, uploaded as a one-day encrypted GitHub artifact, and deleted from the spool. A build-time capability inventory maps every admin-visible UI action/endpoint to the typed relay registry; runtime never scans frontend/repo files.

**Tech Stack:** TypeScript/Netlify Functions, PDF-Lib, ExcelJS, Netlify Blobs/Database, Node.js 22, GitHub Actions/CI, existing Node assertion and Playwright tests.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- Complete Plans 1–3 before declaring the whole portal relay complete.
- Reports are read/export operations unless daily-report CRUD explicitly mutates data.
- Do not log report contents, employee rows, PDF/XLSX bytes, export handles, response keys, or decrypted results.
- Load a report dataset once per logical command and reuse the snapshot for requested formats.
- The normal encrypted JSON result remains capped at 400 KB.
- Large export bytes are encrypted before temporary storage; plaintext export bytes never enter GitHub comments/logs/artifacts or the Netlify export spool.
- Daily-report writes preserve existing owner/admin authorization, author/update metadata, and word limits.
- Capability inventory is build/test-time only.
- Every current admin-visible capability has exactly one classification: `relay-supported`, `relay-read-only`, or `excluded-security`.
- No normal admin capability may remain unclassified at completion.

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

- [ ] **Step 1: Write failing service tests proving one load can feed multiple renderers**

```js
import assert from 'node:assert/strict'
import { createReportAdminService } from '../netlify/functions/_shared/report-admin-service.mts'

let loads = 0
const service = createReportAdminService({
  async loadUnifiedRows(input) {
    loads += 1
    return [{ employeeName: 'A', date: input.from, pauseMinutes: 30, netMinutes: 450 }]
  },
  async buildPdf() { return Buffer.from('%PDF-test') },
  async buildXlsx() { return Buffer.from('PK-test') },
})
const snapshot = await service.inspect({ from: '2026-08-01', to: '2026-08-24', userIds: ['u1'], scope: 'unified' })
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

Expose `inspect(input)`, `render(snapshot, format)`, and `renderSchedulePdf(input)`. Extract row-building/data loading from current production endpoints while preserving company settings, central logo/watermark, PDF and Excel output contracts.

- [ ] **Step 4: Keep data queries targeted**

Continue using `loadReportEvents(from, to, userIds)`. When `userIds` is non-empty, keep SQL employee predicates. Schedule report reads always include `from`/`to` and, when one employee is selected, `employeeUserId`.

- [ ] **Step 5: Run report regressions**

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

## Task 2: Add report relay adapter with a one-time encrypted export spool

**Files:**
- Create: `netlify/functions/_shared/portal-admin-reports.mts`
- Create: `netlify/functions/_shared/portal-admin-export-spool.mts`
- Create: `netlify/functions/portal-admin-export-pull.mts`
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Modify: `scripts/run-schedule-oidc-relay.mjs`
- Modify: `.github/workflows/schedule-oidc-publish.yml`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-report-test.mjs`
- Create: `scripts/portal-admin-export-spool-test.mjs`
- Modify: `scripts/schedule-oidc-workflow-source-test.mjs`

- [ ] **Step 1: Write failing report adapter tests**

Cover exact relay actions: `reports.inspect`, `reports.render-unified`, `reports.render-timesheet`, and `reports.render-schedule-pdf`. Use `input.format` of `pdf` or `xlsx` where applicable. Assert invalid range/format rejection and one underlying snapshot load for a command rendering both formats.

- [ ] **Step 2: Implement the report adapter**

For inspection, return projected rows/counts in encrypted detail. For export, render bytes once. If the complete result is comfortably below 400,000 bytes, return an inline encrypted export package; otherwise spool it.

Registry row example:

```json
{
  "id": "reports.inspect",
  "surface": "Berichte",
  "endpoint": "/api/unified-reports",
  "method": "GET",
  "action": "inspect",
  "classification": "relay-read-only",
  "relay": { "domain": "reports", "action": "inspect" }
}
```

- [ ] **Step 3: Implement encrypted spool storage**

Store only ciphertext in Netlify Blobs store `portal-admin-export-spool`. The response key is available inside `schedule-oidc-trigger` after decrypting the command.

```ts
export type PortalAdminExportPackage = {
  filename: string
  contentType: string
  bytesBase64: string
}

export type EncryptedExportEnvelope = {
  version: 1
  algorithm: 'A256GCM'
  kind: 'portal-admin-export'
  createdAt: string
  expiresAt: string
  iv: string
  ciphertext: string
  tag: string
}
```

Encrypt the entire `PortalAdminExportPackage` with a fresh 12-byte IV and AES-256-GCM using the 32-byte response key. Generate `handle = crypto.randomUUID()`, store envelope at `exports/<handle>`, and set `expiresAt` to 10 minutes later. On every spool write, remove stale entries discovered under `exports/`; the pull endpoint also deletes a requested record after successful read. Never store the response key, plaintext filename, content type, or plaintext bytes outside the encrypted package.

- [ ] **Step 4: Return only opaque handles publicly**

The public trigger response may include:

```ts
const exportHandles = data.exportHandles.map((handle) => String(handle))
```

Do not print handles. Detailed private metadata stays inside the encrypted result/export package.

- [ ] **Step 5: Add an OIDC-protected one-time pull endpoint**

`portal-admin-export-pull.mts` accepts POST JSON `{ oidcToken, handle }`, calls `verifyScheduleGithubOidc`, validates UUID syntax, fetches `exports/<handle>`, rejects expired/missing records, deletes the blob, and returns the encrypted envelope JSON with `Cache-Control: no-store`. It never decrypts the export.

- [ ] **Step 6: Extend the runner to pull encrypted exports**

If `exportHandles` is non-empty, `run-schedule-oidc-relay.mjs` calls `/api/portal-admin-export-pull` once per handle with the same OIDC token and writes each returned encrypted envelope to generic files `/tmp/habun-portal-admin-export-1.json`, `/tmp/habun-portal-admin-export-2.json`, and so on. The runner never prints handles or response bodies.

- [ ] **Step 7: Extend workflow artifact upload**

Keep `habun-schedule-encrypted-result` unchanged. Add a conditional upload for `/tmp/habun-portal-admin-export-*.json` named `habun-portal-admin-encrypted-export`, retention 1 day. This stays within the same issue-comment/OIDC workflow, not a second control path.

- [ ] **Step 8: Register report capabilities and handler**

Add read-only registry rows for `reports.inspect`, `reports.render-unified`, `reports.render-timesheet`, and `reports.render-schedule-pdf`; register `reports: createReportsPortalAdminHandler(context)`.

- [ ] **Step 9: Run focused tests**

```bash
node --experimental-strip-types scripts/portal-admin-report-test.mjs
node --experimental-strip-types scripts/portal-admin-export-spool-test.mjs
node scripts/portal-admin-oidc-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/report-production-v2-test.mjs
node scripts/final-export-logo-test.mjs
```

- [ ] **Step 10: Commit**

```bash
git add netlify/functions/_shared/portal-admin-reports.mts netlify/functions/_shared/portal-admin-export-spool.mts netlify/functions/portal-admin-export-pull.mts netlify/functions/schedule-oidc-trigger.mts scripts/run-schedule-oidc-relay.mjs .github/workflows/schedule-oidc-publish.yml ops/portal-admin-capabilities.json scripts/portal-admin-report-test.mjs scripts/portal-admin-export-spool-test.mjs scripts/schedule-oidc-workflow-source-test.mjs
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

- [ ] **Step 1: Write failing CRUD service tests**

Use an in-memory report store and deterministic actor/time. Verify create/update/delete/list and the existing 1000-word maximum.

- [ ] **Step 2: Extract shared business logic**

Move `MAX_REPORT_WORDS`, `countWords`, and `validateDailyReportText` into the shared service/model layer. Define:

```ts
export type DailyReportAdminActor = {
  userId: string
  fullName: string
  role: 'owner' | 'admin'
}
```

Service methods are `list(date?)`, `get(id)`, `create(input, actor)`, `update(id, input, actor)`, `delete(id, actor)`, and a PDF renderer that reuses the current daily-report PDF rendering logic.

- [ ] **Step 3: Keep browser security checks in HTTP endpoint**

`daily-reports.mts` retains `requirePortalRole(['owner','admin'])`, current author-name derivation, and `verifyRequestOrigin` for POST/PATCH/DELETE, then delegates to the service.

- [ ] **Step 4: Add relay actions**

Register exact actions: `reports.daily-list`, `reports.daily-get`, `reports.daily-create`, `reports.daily-update`, `reports.daily-delete`, and `reports.daily-pdf`. Delete requires `confirm: true`; list/get/PDF are read-only; create/update/delete are supported mutations. Use stable actor `{ userId:'portal-admin-relay', fullName:'Portal Admin Relay', role:'owner' }`.

- [ ] **Step 5: Run tests and commit**

```bash
node --experimental-strip-types scripts/portal-admin-daily-report-test.mjs
node scripts/daily-report-crud-test.mjs
node scripts/daily-report-pdf-test.mjs
node scripts/daily-report-ui-test.mjs
node scripts/admin-overview-daily-report-test.mjs
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

- [ ] **Step 1: Define authoritative admin surface files**

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

Do not scan generated `public/assets`.

- [ ] **Step 2: Write failing inventory tests**

Tests must: assert navigation surfaces `Übersicht`, `Zeiterfassung`, `Mitarbeiter`, `Dienstplan`, `Stundenzettel`, `Einsatzorte`, `Berichte`, `Einstellungen`; extract literal `/api/` endpoint strings; ignore only explicit session/auth infrastructure; require every discovered business endpoint in at least one registry row; require unique IDs/exactly one valid classification; require typed relay domain/action for supported/read-only rows; and require a reason for security exclusions.

- [ ] **Step 3: Inventory multiplexed actions explicitly**

At minimum cover: overview live attendance/today schedule/daily reports; timekeeping history/admin create/edit/timesheet exports; employees list/profile/role/deactivation; schedule list/save/update/delete/publish/copy/directory/PDF; worksites list/get/save/map/delete; unified reports; company settings/logo; and any distinct `/api/settings` action still reachable from current UI.

- [ ] **Step 4: Classify exclusions narrowly**

Only passwords/auth secrets, owner self-protection bypass, legal-hold bypass, secret/environment exposure, arbitrary SQL/server code, and infrastructure mutation qualify as `excluded-security`. A normal unsupported admin function must gain a relay adapter instead.

- [ ] **Step 5: Generate the matrix deterministically**

`portal-admin-capability-inventory.mjs` generates `docs/portal-admin-capability-matrix.md` from JSON with surface, ID, endpoint/action, classification, relay domain/action, and exclusion reason. `--check` exits nonzero if generated content differs.

- [ ] **Step 6: Run and commit**

```bash
node scripts/portal-admin-capability-inventory-test.mjs
node scripts/portal-admin-capability-inventory.mjs --check
git add ops/portal-admin-capabilities.json scripts/portal-admin-capability-inventory.mjs scripts/portal-admin-capability-inventory-test.mjs docs/portal-admin-capability-matrix.md
git commit -m "test: inventory every admin portal capability"
```

---

## Task 5: Add the CI completeness gate

**Files:**
- Modify: `package.json`
- Modify: the existing CI/verification workflow that already runs repository verification
- Create: `scripts/portal-admin-full-verification-test.mjs`

- [ ] **Step 1: Add `verify:portal-admin`**

```json
"verify:portal-admin": "npm run verify:portal-admin-foundation && npm run verify:portal-admin-schedule-attendance && npm run verify:portal-admin-domains && node --experimental-strip-types scripts/portal-admin-report-test.mjs && node --experimental-strip-types scripts/portal-admin-export-spool-test.mjs && node --experimental-strip-types scripts/portal-admin-daily-report-test.mjs && node scripts/portal-admin-capability-inventory-test.mjs && node scripts/portal-admin-capability-inventory.mjs --check"
```

- [ ] **Step 2: Include it once in normal verification**

Add it to `verify:unified` or `verify:all`; do not duplicate the full suite in a second expensive CI job.

- [ ] **Step 3: Add runtime-cost source guards**

Assert inventory scripts are never imported by Netlify runtime functions, runtime adapters do not read frontend files, targeted directory reads do not full-sync, `MAX_OPERATIONS` remains 100, multi-format reports reuse one snapshot, and export spool stores ciphertext only and deletes on successful pull.

- [ ] **Step 4: Run verification/build/E2E**

```bash
npm run verify:portal-admin
npm run verify
npm run build
npx playwright test tests/e2e/unified-portal.spec.mjs tests/e2e/employee-role-management.spec.mjs tests/e2e/worksite-feature.spec.mjs tests/e2e/admin-time-editing.spec.mjs
```

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows scripts/portal-admin-full-verification-test.mjs
git commit -m "ci: require complete portal admin relay coverage"
```

---

## Task 6: Final privacy, transport, and call-efficiency acceptance

**Files:**
- Create: `scripts/portal-admin-acceptance-test.mjs`

- [ ] **Step 1: Build representative acceptance flows**

Test Kwame history correction, monthly pause bulk update, employee-profile + worksite batch, and report inspect + PDF export.

- [ ] **Step 2: Assert sparse call budgets**

```js
assert.deepEqual(kwameActions, ['inspect-employee-history', 'rebind-employee-history', 'inspect-employee-history'])
assert.deepEqual(monthlyPauseActions, ['inspect-employee-history', 'portal-batch', 'inspect-employee-history'])
assert.equal(profileWorksiteBatch.operations.length, 2)
```

- [ ] **Step 3: Assert GitHub-visible privacy**

Verify marker `<!-- habun-schedule-envelope-v1 -->`, safe status contexts, no runner logging of handles/payloads/keys/names, encrypted artifacts, and one-day artifact retention.

- [ ] **Step 4: Run transport compatibility and full acceptance**

```bash
node scripts/schedule-oidc-workflow-source-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/attendance-oidc-trigger-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
node --experimental-strip-types scripts/portal-admin-acceptance-test.mjs
npm run verify:portal-admin
npm run verify
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add scripts/portal-admin-acceptance-test.mjs
git commit -m "test: accept full portal admin relay"
```

## Full Portal Done Criteria

- Every current admin-visible business capability is classified exactly once.
- Every normal business capability is relay-supported or relay-read-only; security exclusions are narrow and documented.
- Employee, schedule, attendance/timesheet, worksite, company, reports/export, and daily-report actions use typed services/adapters through the encrypted PR #73 relay.
- Existing browser UI and policy regressions pass.
- Existing schedule relay commands remain backward compatible.
- No normal operation requires browser-by-browser entry, direct SQL, or a deployment.
- Capability scanning happens only in build/test.
- Large exports use the encrypted one-time spool and never expose plaintext to GitHub.
- Representative correction flows prove the sparse-call target `1 read -> 1 batch -> 1 verification`.
- `npm run verify:portal-admin`, `npm run verify`, and `npm run build` pass before completion is claimed.