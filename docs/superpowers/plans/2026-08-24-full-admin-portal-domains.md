# Full Admin Portal Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full relay administration for employees/registrations, worksites, and company settings/logo while reusing the portal's existing owner/admin business rules and keeping reads/writes targeted.

**Architecture:** Extract reusable domain services from the current HTTP endpoints. Browser endpoints keep session/origin checks and delegate to those services; portal-admin adapters call the same services with a stable internal owner-equivalent actor. Avoid full directory synchronization for targeted employee work. Preserve owner-account protections, employee management policy, worksite reference safety, geofence synchronization, and company logo validation.

**Tech Stack:** TypeScript/Netlify Functions, Netlify Identity/Admin API, Netlify Blobs, Netlify Database/Postgres, existing employee/worksite/company helpers, Node assertion tests, Playwright E2E regressions.

**Spec:** `docs/superpowers/specs/2026-08-24-full-admin-portal-relay-design.md`

## Global Constraints

- Complete Foundation Plan first. Schedule/attendance Plan may proceed in parallel only where files do not overlap.
- The relay actor has owner-equivalent business privileges, not infrastructure/secret privileges.
- Existing owner account cannot be downgraded, deactivated, or deleted through the relay.
- Browser writes still require their current origin/session checks; relay calls services directly and never forges browser sessions.
- No password, login token, environment variable, raw Netlify Identity credential, or database credential may be surfaced through relay results.
- Targeted employee lookup must not trigger `syncScheduleEmployees(..., true)` unless the operation explicitly requests a directory sync.
- Worksite deletion must use the same business constraints as the portal and must not silently delete shifts or attendance history.
- Company logo mutation is destructive/configuration-sensitive and only executes on an explicit user request.
- Cost target remains one targeted read, one batch, one verification.

---

## Task 1: Extract employee administration into a reusable service

**Files:**
- Create: `netlify/functions/_shared/employee-admin-service.mts`
- Modify: `netlify/functions/registrations.mts`
- Modify: `netlify/functions/_shared/employee-management-policy.mts`
- Create: `scripts/employee-admin-service-test.mjs`
- Modify: `scripts/employee-role-management-policy-test.mjs`

- [ ] **Step 1: Write failing service tests**

Use an in-memory repository so policy behavior is tested independently of HTTP/session plumbing.

```js
import assert from 'node:assert/strict'
import { createEmployeeAdminService } from '../netlify/functions/_shared/employee-admin-service.mts'

const rows = new Map([
  ['owner-1', { userId: 'owner-1', fullName: 'Owner', role: 'owner', status: 'active', company: 'Habun', location: 'Zentrale' }],
  ['u1', { userId: 'u1', fullName: 'Mitarbeiter A', role: 'employee', status: 'active', company: 'Habun', location: 'Abbott' }],
])
const repository = {
  async get(userId) { return rows.get(userId) || null },
  async list() { return [...rows.values()] },
  async save(row) { rows.set(row.userId, row); return row },
  async syncScheduleEmployee() {},
  async deactivateScheduleEmployee() {},
}
const service = createEmployeeAdminService(repository)
const actor = { userId: 'portal-admin-relay', role: 'owner' }

const updated = await service.updateProfile(actor, 'u1', { fullName: 'Mitarbeiter Neu', company: 'Habun', location: 'Objekt 1' })
assert.equal(updated.fullName, 'Mitarbeiter Neu')
await assert.rejects(() => service.deactivate(actor, 'owner-1'), /Hauptadmin/)
```

- [ ] **Step 2: Run and confirm failure**

```bash
node --experimental-strip-types scripts/employee-admin-service-test.mjs
```

- [ ] **Step 3: Define the service contract**

```ts
export type EmployeeAdminActor = { userId: string; role: 'owner' | 'admin' }
export type EmployeeAdminProfilePatch = {
  fullName: string
  company: string
  location: string
}

export type EmployeeAdminRepository = {
  get(userId: string): Promise<EmployeeAdminRecord | null>
  list(): Promise<EmployeeAdminRecord[]>
  save(record: EmployeeAdminRecord): Promise<EmployeeAdminRecord>
  syncScheduleEmployee(record: EmployeeAdminRecord): Promise<void>
  deactivateScheduleEmployee(userId: string): Promise<void>
}
```

Expose:

- `getEmployee(actor, userId)`
- `listEmployees(actor, filters)`
- `updateProfile(actor, userId, patch)`
- `updateRole(actor, userId, requestedRole)`
- `deactivate(actor, userId)`

All mutations must call `employeeManagementPolicy` before storage writes.

- [ ] **Step 4: Move current registrations mutation logic into the service**

Preserve the current policy behavior:

- owner can update normal profile data, including own normal profile data.
- owner cannot downgrade/deactivate own protected owner account.
- normal admin cannot modify another admin/owner.
- normal admin cannot assign admin.
- role/profile changes synchronize the schedule employee projection.
- deactivation calls `deactivateScheduleEmployee`.

`registrations.mts` remains responsible for:

- `requirePortalRole(...)`.
- `verifyRequestOrigin` for PATCH.
- JSON/body parsing.
- translating service errors to HTTP status/messages.

- [ ] **Step 5: Run employee tests**

```bash
node --experimental-strip-types scripts/employee-admin-service-test.mjs
node scripts/employee-role-management-policy-test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/employee-admin-service.mts netlify/functions/registrations.mts netlify/functions/_shared/employee-management-policy.mts scripts/employee-admin-service-test.mjs scripts/employee-role-management-policy-test.mjs
git commit -m "refactor: share employee administration rules"
```

---

## Task 2: Add low-cost targeted employee directory reads

**Files:**
- Create: `netlify/functions/_shared/portal-employee-directory.mts`
- Modify: `netlify/functions/schedule-directory.mts`
- Create: `scripts/portal-employee-directory-test.mjs`

- [ ] **Step 1: Write failing tests for targeted lookup**

```js
import assert from 'node:assert/strict'
import { normalizeEmployeeDirectoryFilters } from '../netlify/functions/_shared/portal-employee-directory.mts'

assert.deepEqual(normalizeEmployeeDirectoryFilters({ userId: 'u1' }), { userId: 'u1', name: '', status: 'active' })
assert.deepEqual(normalizeEmployeeDirectoryFilters({ name: '  Kwame Akakpo ' }), { userId: '', name: 'Kwame Akakpo', status: 'active' })
```

Add a source assertion that the targeted helper does not call `syncScheduleEmployees`.

- [ ] **Step 2: Implement `getPortalEmployeeByUserId`**

When user ID is known, fetch only `access/<userId>` from `portal-access`; do not list the entire store.

```ts
export async function getPortalEmployeeByUserId(userId: string) {
  const store = getStore({ name: 'portal-access', consistency: 'strong' })
  const row = await store.get(`access/${userId}`, { type: 'json' }) as AccessRecord | null
  return row?.userId ? mapAccessRecord(row) : null
}
```

For exact-name lookup, one store listing is acceptable because blob keys are user IDs and there is no secondary name index. Cache/reuse that list only within the current command/router context; do not persist it client-side.

- [ ] **Step 3: Separate schedule-directory read from explicit sync**

Refactor `schedule-directory.mts` so a normal GET can return the directory without mutating the schedule projection. If the existing UI depends on synchronization, expose an explicit internal `syncScheduleDirectoryProjection(employees)` call from mutation workflows or a separate protected action; do not hide a full sync behind every GET.

Update source tests that currently assume GET performs sync so they assert the new explicit sync location instead.

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types scripts/portal-employee-directory-test.mjs
node scripts/scheduler-support-test.mjs
node scripts/schedule-assistant-source-test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/portal-employee-directory.mts netlify/functions/schedule-directory.mts scripts/portal-employee-directory-test.mjs scripts/scheduler-support-test.mjs scripts/schedule-assistant-source-test.mjs
git commit -m "perf: make employee directory reads targeted and side effect free"
```

---

## Task 3: Add employee relay adapter and batch actions

**Files:**
- Create: `netlify/functions/_shared/portal-admin-employees.mts`
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-employee-test.mjs`

- [ ] **Step 1: Write failing adapter tests**

Test actions:

- `get`
- `list`
- `update-profile`
- `update-role`
- `deactivate-account`

The adapter receives a stable relay actor:

```ts
const PORTAL_RELAY_EMPLOYEE_ACTOR = { userId: 'portal-admin-relay', role: 'owner' as const }
```

A target owner record must still be protected because policy checks target role/user identity, not browser session.

- [ ] **Step 2: Implement the adapter using `employee-admin-service`**

Example:

```ts
if (operation.action === 'update-profile') {
  const userId = text(operation.input.userId)
  const employee = await service.updateProfile(PORTAL_RELAY_EMPLOYEE_ACTOR, userId, {
    fullName: text(operation.input.fullName),
    company: text(operation.input.company),
    location: text(operation.input.location),
  })
  return { itemId: operation.itemId, domain: 'employees', action: operation.action, status: 'success', data: safeEmployeeProjection(employee) }
}
```

Safe projection excludes email/auth metadata unless an explicit admin-visible business action requires it.

- [ ] **Step 3: Register capabilities**

Add:

- `employees.get` -> relay-read-only.
- `employees.list` -> relay-read-only.
- `employees.update-profile` -> relay-supported.
- `employees.update-role` -> relay-supported.
- `employees.deactivate-account` -> relay-supported.

Do not register password reset, auth token, Identity metadata mutation, or owner downgrade.

- [ ] **Step 4: Register handler in OIDC router**

Add `employees: createEmployeePortalAdminHandler()` without changing legacy path.

- [ ] **Step 5: Run tests**

```bash
node --experimental-strip-types scripts/portal-admin-employee-test.mjs
node scripts/employee-role-management-policy-test.mjs
node scripts/portal-admin-oidc-source-test.mjs
```

- [ ] **Step 6: Run existing employee E2E test**

```bash
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/portal-admin-employees.mts netlify/functions/schedule-oidc-trigger.mts ops/portal-admin-capabilities.json scripts/portal-admin-employee-test.mjs
git commit -m "feat: administer employees through encrypted relay"
```

---

## Task 4: Extract worksite administration into a reusable service

**Files:**
- Create: `netlify/functions/_shared/worksite-admin-service.mts`
- Modify: `netlify/functions/worksite-v2.mts`
- Modify: `netlify/functions/schedule-v2.mts`
- Create: `scripts/worksite-admin-service-test.mjs`
- Modify: `scripts/worksite-delete-policy-test.mjs`

- [ ] **Step 1: Write failing worksite service tests**

Use a fake blob/object repository and fake attendance-object sync.

Test:

- list/get.
- save new/updated worksite.
- latitude/longitude/radius validation.
- delete an unused worksite.
- reject destructive delete when explicit reference policy says it is in use.
- delete does not delete schedule rows.

- [ ] **Step 2: Define the service contract**

```ts
export type WorksiteAdminActor = { userId: string; role: 'owner' | 'admin' }
export type WorksiteAdminInput = {
  id?: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  radiusMeters: number
}
```

Expose:

- `listWorksites(actor)`
- `getWorksite(actor, id)`
- `saveWorksite(actor, input)`
- `deleteWorksite(actor, id)`
- `resolveGoogleMapsWorksite(actor, url)` if the current portal function remains admin-visible.

- [ ] **Step 3: Move validation/storage logic from current endpoints**

Use the existing `portal-schedule-v2` object keys and `attendance_objects` synchronization semantics. Keep Google Maps URL resolution in `_shared/google-maps-location.mts`.

For delete:

- delete only the worksite object record.
- do not cascade-delete shifts.
- before delete, inspect references needed to return a clear warning/conflict according to current portal behavior.
- if current portal currently allows deletion while historic shift references remain, preserve that behavior but return reference counts in the encrypted result so the caller can verify impact; do not invent a stronger destructive cascade.

- [ ] **Step 4: Convert browser endpoints/actions to service adapters**

`worksite-v2.mts` retains actor/session/origin checks and calls service. `schedule-v2.mts` `object-delete` delegates to the same service so there is one delete implementation.

- [ ] **Step 5: Run worksite tests**

```bash
node --experimental-strip-types scripts/worksite-admin-service-test.mjs
node scripts/worksite-delete-policy-test.mjs
node scripts/google-maps-location-test.mjs
node scripts/device-geolocation-contract-test.mjs
node scripts/location-accuracy-service-contract-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/worksite-admin-service.mts netlify/functions/worksite-v2.mts netlify/functions/schedule-v2.mts scripts/worksite-admin-service-test.mjs scripts/worksite-delete-policy-test.mjs
git commit -m "refactor: share worksite administration rules"
```

---

## Task 5: Add worksite relay adapter

**Files:**
- Create: `netlify/functions/_shared/portal-admin-worksites.mts`
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-worksite-test.mjs`

- [ ] **Step 1: Write failing adapter tests**

Cover `list`, `get`, `save`, `delete`, and `resolve-map`.

- [ ] **Step 2: Implement handler using the shared service**

Use stable actor `{ userId: 'portal-admin-relay', role: 'owner' }`. Validate explicit destructive intent: `delete` input must include `confirm: true`; otherwise return `rejected` code `DESTRUCTIVE_CONFIRMATION_REQUIRED`.

- [ ] **Step 3: Register capabilities**

```json
[
  { "id": "worksites.list", "classification": "relay-read-only", "relay": { "domain": "worksites", "action": "list" } },
  { "id": "worksites.get", "classification": "relay-read-only", "relay": { "domain": "worksites", "action": "get" } },
  { "id": "worksites.save", "classification": "relay-supported", "relay": { "domain": "worksites", "action": "save" } },
  { "id": "worksites.delete", "classification": "relay-supported", "relay": { "domain": "worksites", "action": "delete" } },
  { "id": "worksites.resolve-map", "classification": "relay-supported", "relay": { "domain": "worksites", "action": "resolve-map" } }
]
```

Fill the full required registry fields, not abbreviated objects.

- [ ] **Step 4: Run adapter + E2E regression**

```bash
node --experimental-strip-types scripts/portal-admin-worksite-test.mjs
npx playwright test tests/e2e/worksite-feature.spec.mjs
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/portal-admin-worksites.mts netlify/functions/schedule-oidc-trigger.mts ops/portal-admin-capabilities.json scripts/portal-admin-worksite-test.mjs
git commit -m "feat: administer worksites through encrypted relay"
```

---

## Task 6: Add company settings and logo relay service/adapter

**Files:**
- Create: `netlify/functions/_shared/company-admin-service.mts`
- Modify: `netlify/functions/company-settings.mts`
- Create: `netlify/functions/_shared/portal-admin-company.mts`
- Modify: `netlify/functions/schedule-oidc-trigger.mts`
- Modify: `ops/portal-admin-capabilities.json`
- Create: `scripts/portal-admin-company-test.mjs`

- [ ] **Step 1: Write failing service/adapter tests**

Cover:

- get settings.
- update company name/phone/email/address.
- reject invalid email.
- get logo metadata without returning raw bytes by default.
- set prepared PNG logo data only on explicit action.
- reset logo only with explicit destructive confirmation.

- [ ] **Step 2: Implement a shared company admin service**

Reuse existing helpers:

```ts
import { readCompanySettings, writeCompanySettings, writeCompanyLogoSettings } from './company-settings.mts'
import { saveCustomPdfLogo, resetCustomPdfLogo, readPdfLogoBytes } from './pdf-branding.mts'
```

Expose:

```ts
getSettings()
updateSettings(input, actor)
getLogoMetadata()
setLogoPng(dataUrl, actor)
resetLogo(actor)
```

Do not return raw logo bytes in a normal settings inspection. For an explicit logo-read/export action, use encrypted result only and enforce the current response-size guard.

- [ ] **Step 3: Keep browser endpoint permissions unchanged**

`company-settings.mts` continues to:

- allow GET for owner/admin.
- allow text settings writes according to current owner/admin policy.
- allow custom/reset PDF logo only to owner where current UI does so.
- verify origin for browser writes.

It delegates data mutations to `company-admin-service`.

- [ ] **Step 4: Implement company relay actions**

Register:

- `company.get-settings` -> relay-read-only.
- `company.update-settings` -> relay-supported.
- `company.get-logo-metadata` -> relay-read-only.
- `company.set-logo` -> relay-supported.
- `company.reset-logo` -> relay-supported.

`set-logo` requires input `pdfLogoDataUrl` matching the same MIME/size validation used by `saveCustomPdfLogo`. `reset-logo` requires `confirm: true`.

- [ ] **Step 5: Register company handler in OIDC router**

Add `company: createCompanyPortalAdminHandler()`.

- [ ] **Step 6: Run company regressions**

```bash
node --experimental-strip-types scripts/portal-admin-company-test.mjs
node scripts/company-settings-test.mjs
node scripts/pdf-logo-feature-test.mjs
node scripts/final-export-logo-test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/company-admin-service.mts netlify/functions/company-settings.mts netlify/functions/_shared/portal-admin-company.mts netlify/functions/schedule-oidc-trigger.mts ops/portal-admin-capabilities.json scripts/portal-admin-company-test.mjs
git commit -m "feat: administer company settings through encrypted relay"
```

---

## Task 7: Prove one-batch multi-domain administration

**Files:**
- Create: `scripts/portal-admin-domains-integration-test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Build a multi-domain batch fixture**

Test one `portal-batch` containing:

1. employee profile location update.
2. worksite update.
3. company phone update.

Assert operation order is retained, each handler is invoked once, and verification reads use only those three targets rather than listing unrelated data.

- [ ] **Step 2: Assert protected operations remain rejected**

Same integration test should include a second command attempting owner deactivation and assert `rejected` with policy code/message in encrypted detail.

- [ ] **Step 3: Add focused verify script**

```json
"verify:portal-admin-domains": "node --experimental-strip-types scripts/employee-admin-service-test.mjs && node --experimental-strip-types scripts/portal-employee-directory-test.mjs && node --experimental-strip-types scripts/portal-admin-employee-test.mjs && node --experimental-strip-types scripts/worksite-admin-service-test.mjs && node --experimental-strip-types scripts/portal-admin-worksite-test.mjs && node --experimental-strip-types scripts/portal-admin-company-test.mjs && node --experimental-strip-types scripts/portal-admin-domains-integration-test.mjs"
```

- [ ] **Step 4: Run focused verification**

```bash
npm run verify:portal-admin-domains
```

- [ ] **Step 5: Run relevant UI regressions**

```bash
node scripts/employee-role-management-policy-test.mjs
node scripts/worksite-delete-policy-test.mjs
node scripts/company-settings-test.mjs
npx playwright test tests/e2e/employee-role-management.spec.mjs tests/e2e/worksite-feature.spec.mjs
```

- [ ] **Step 6: Run full verification**

```bash
npm run verify
```

- [ ] **Step 7: Commit**

```bash
git add scripts/portal-admin-domains-integration-test.mjs package.json
git commit -m "test: verify employee worksite company relay domains"
```

## Portal Domains Done Criteria

- Employee/profile/role/status administration uses the same policy service for UI and relay.
- Protected owner account rules still apply to the relay.
- Targeted employee lookup does not cause a full schedule-directory sync.
- Worksites can be read/updated/deleted/resolved through typed relay actions without cascade-deleting shifts.
- Company settings/logo actions use existing validation and owner rules.
- A multi-domain command can perform independent admin changes in one encrypted batch with one ordered result set.