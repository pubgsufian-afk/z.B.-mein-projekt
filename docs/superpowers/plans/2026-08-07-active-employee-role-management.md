# Active Employee Role Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active employee accounts fully manageable according to the approved hierarchy: Hauptadmin has complete account/role control, Admin can fully manage employees and switch Mitarbeiter ↔ Einsatzleiter, but only Hauptadmin can create/change/delete Admin accounts and the Hauptadmin account remains protected.

**Architecture:** Keep `portal-access` as the authoritative role/access store and `schedule_employees` as the synchronized scheduling directory. Extend the production `/api/registrations` wrapper with direct active-account actions (`update-role`, `deactivate-account`) and hard server-side permission checks. Add a focused employee-card management module to the existing frontend, and tighten `currentPortalActor()` so a deactivated access record cannot regain privileges from stale Identity metadata.

**Tech Stack:** React 19/Vite frontend, Netlify Functions, Netlify Blobs (`portal-access`), Netlify Identity, Netlify Database/Neon schedule directory, Node contract tests, Playwright E2E.

## Global Constraints

- Hauptadmin (`owner`) may manage all non-owner accounts and assign/remove `admin`.
- Admin (`admin`) may manage only `employee` and `manager` targets and may assign only `employee` or `manager`.
- Admin may never alter/deactivate an `admin` or `owner` target.
- Only Hauptadmin may assign `admin` or deactivate an Admin account.
- The configured Hauptadmin account must never be demoted or deleted by this feature.
- `manager` and `employee` get no role/account-management writes.
- Permission checks must be server-side; UI hiding is only convenience.
- Role/status changes must stay synchronized between `portal-access` and `schedule_employees`.
- No visual redesign outside the employee cards.

---

### Task 1: Refresh the existing role-management branch onto current `main`

**Files:**
- Reconcile: `package.json`
- Preserve current-main attendance/worksite changes from PR #34.
- Keep existing PR #33 role-management files as the starting implementation.

**Interfaces:**
- Consumes: current `main` after PR #34.
- Produces: a conflict-free feature branch containing only employee-role/account-management changes plus tests.

- [ ] **Step 1: Compare PR #33 against current `main`**

Check that PR #34's `verify:v2` addition (`apply-attendance-worksite-rebind.mjs`) remains in `package.json` while adding role-management verification.

- [ ] **Step 2: Reapply only the role-management changes on top of current `main`**

Expected `verify:v2` shape must include both the current attendance rebind pipeline and the new role test, e.g.:

```json
"verify:v2": "node scripts/apply-attendance-location-fix.mjs && node scripts/apply-attendance-worksite-rebind.mjs && node scripts/attendance-v2-verify.mjs && node scripts/admin-time-editing-test.mjs && node scripts/employee-role-management-test.mjs"
```

- [ ] **Step 3: Commit the refreshed branch**

```bash
git add package.json frontend/src netlify/functions scripts tests/e2e
git commit -m "chore: refresh employee role management on current main"
```

---

### Task 2: Add failing permission tests for active role changes and account deletion

**Files:**
- Modify: `scripts/employee-role-management-test.mjs`
- Modify: `tests/e2e/employee-role-management.spec.mjs`

**Interfaces:**
- Consumes: `/api/registrations` PATCH contract.
- Produces: required actions `update-role` and `deactivate-account` plus UI expectations.

- [ ] **Step 1: Extend the contract test first**

Add assertions requiring all of these server markers:

```js
assert.ok(registrations.includes("payload?.action === 'update-role'"))
assert.ok(registrations.includes("payload?.action === 'deactivate-account'"))
assert.ok(registrations.includes("target.role === 'owner'"))
assert.ok(registrations.includes("target.role === 'admin'"))
assert.ok(registrations.includes("role === 'admin' && access.current.role !== 'owner'"))
assert.ok(registrations.includes("status: 'inactive'"))
```

Add frontend markers for:

```js
'Rolle ändern'
'Konto löschen'
'Nur Hauptadmin darf Admin-Konten ändern.'
'Hauptadmin ist geschützt.'
```

- [ ] **Step 2: Add E2E cases that are initially red**

Required browser cases:

```js
test('Hauptadmin can assign Admin to an active employee', ...)
test('Admin can switch employee to manager but has no Admin option', ...)
test('Admin cannot manage an existing Admin card', ...)
test('Hauptadmin can delete an Admin account from the portal', ...)
test('Hauptadmin account is shown as protected and has no delete action', ...)
```

The delete test must assert PATCH payload:

```js
{ id: 'admin-target', action: 'deactivate-account' }
```

- [ ] **Step 3: Run focused tests and confirm they fail for the missing delete/deactivation path**

Run:

```bash
node scripts/employee-role-management-test.mjs
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: at least the new delete/deactivation assertions fail before implementation.

---

### Task 3: Enforce deactivated accounts in portal role resolution

**Files:**
- Modify: `netlify/functions/_shared/portal-role.mts`
- Test: `scripts/employee-role-management-test.mjs`

**Interfaces:**
- Consumes: `portal-access/access/<userId>` records with `status`.
- Produces: `currentPortalActor()` that never falls back to stale Identity admin/manager roles when an explicit non-active access record exists.

- [ ] **Step 1: Add the failing source assertion**

Require an explicit inactive/rejected access branch before Identity metadata fallback.

- [ ] **Step 2: Implement authoritative access status handling**

Use this decision order:

```ts
const role = owners.has(email)
  ? 'owner'
  : access && access.status !== 'active'
    ? 'pending'
    : access?.status === 'active' && access.role && VALID_ROLES.has(access.role)
      ? access.role
      : identityRole
```

This ensures a deleted/deactivated portal account cannot regain `admin` from stale Netlify Identity metadata.

- [ ] **Step 3: Run the focused contract test**

```bash
node scripts/employee-role-management-test.mjs
```

Expected: access-status protection assertion passes; remaining missing API/UI assertions may still fail until later tasks.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/_shared/portal-role.mts scripts/employee-role-management-test.mjs
git commit -m "fix: make portal access status authoritative"
```

---

### Task 4: Implement server-side active-account role and deletion policy

**Files:**
- Modify: `netlify/functions/registrations.mts`
- Modify: `netlify/functions/_shared/schedule-neon-repository.mts` only if a small helper is needed to mark a single schedule employee inactive.
- Test: `scripts/employee-role-management-test.mjs`

**Interfaces:**
- Consumes PATCH JSON:

```ts
{ id: string, action: 'update-role', role: 'employee' | 'manager' | 'admin' }
{ id: string, action: 'deactivate-account' }
```

- Produces success responses:

```ts
{ ok: true, employee: AccessRecord, role: string }
{ ok: true, deactivated: true, userId: string }
```

- [ ] **Step 1: Keep GET role enrichment from PR #33**

`GET /api/registrations` must merge authoritative `portal-access` roles into `data.employees` so the UI always shows the current role.

- [ ] **Step 2: Implement/update `updateActiveEmployeeRole()` with exact guards**

```ts
if (!['owner', 'admin'].includes(actor.role)) return 403
if (target.role === 'owner') return 403
if (actor.role === 'admin' && target.role === 'admin') return 403
if (role === 'admin' && actor.role !== 'owner') return 403
if (actor.role === 'admin' && !['employee', 'manager'].includes(role)) return 403
```

Persist the updated role to `portal-access`, then call `upsertScheduleEmployee({... status: 'active' ...})`.

- [ ] **Step 3: Implement `deactivateActiveEmployee()`**

Permission matrix:

```ts
owner -> may deactivate admin | manager | employee
admin -> may deactivate manager | employee
admin -> may NOT deactivate admin | owner
owner/admin -> may NOT deactivate owner
manager/employee -> no access
```

Persist a tombstone access record rather than deleting the blob completely:

```ts
const employee = {
  ...target,
  role: 'pending',
  status: 'rejected',
  grantedAt: now,
  grantedBy: actor.userId,
}
await store.setJSON(key, employee)
```

Then mark the schedule directory record inactive using:

```ts
await upsertScheduleEmployee({
  userId,
  fullName,
  role: previousRole,
  status: 'inactive',
  location,
})
```

If `upsertScheduleEmployee()` intentionally ignores inactive rows, add a focused helper such as:

```ts
export async function setScheduleEmployeeInactive(userId: string) {
  const database = getDatabase()
  await database.pool.query(
    "UPDATE schedule_employees SET status = 'inactive', synced_at = now() WHERE user_id = $1",
    [userId],
  )
}
```

- [ ] **Step 4: Route both actions before proxying to the legacy backend**

```ts
if (request.method === 'PATCH') {
  const payload = await request.clone().json().catch(() => null)
  if (payload?.action === 'update-role') return updateActiveEmployeeRole(request, access)
  if (payload?.action === 'deactivate-account') return deactivateActiveEmployee(request, access)
}
```

- [ ] **Step 5: Run focused contract tests**

```bash
node scripts/employee-role-management-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/registrations.mts netlify/functions/_shared/schedule-neon-repository.mts scripts/employee-role-management-test.mjs
git commit -m "feat: enforce active account role hierarchy"
```

---

### Task 5: Add active employee role/edit/delete controls to the portal UI

**Files:**
- Modify/Create: `frontend/src/employee-role-management-auto.js`
- Modify: `frontend/src/main.jsx` or `scripts/build-frontend.mjs` using the existing isolated-module pattern.
- Test: `tests/e2e/employee-role-management.spec.mjs`

**Interfaces:**
- Consumes: `/api/session`, `GET /api/registrations`, PATCH actions from Task 4.
- Produces: role badge, role selector, save button, protected-state text, and permitted delete button on active employee cards.

- [ ] **Step 1: Keep the PR #33 role editor behavior**

Role options:

```js
const options = actorRole === 'owner'
  ? [['employee', 'Mitarbeiter'], ['manager', 'Einsatzleiter'], ['admin', 'Admin']]
  : [['employee', 'Mitarbeiter'], ['manager', 'Einsatzleiter']]
```

- [ ] **Step 2: Apply exact protected-target rules**

```js
const protectedTarget = currentRole === 'owner' || (actorRole !== 'owner' && currentRole === 'admin')
```

For protected targets, show text only, no selector and no delete button.

- [ ] **Step 3: Add `Konto löschen` only when permitted**

```js
const canDelete = actorRole === 'owner'
  ? currentRole !== 'owner'
  : actorRole === 'admin' && ['employee', 'manager'].includes(currentRole)
```

On click, require confirmation and send:

```js
await jsonFetch('/api/registrations', {
  method: 'PATCH',
  body: JSON.stringify({ id: targetId, action: 'deactivate-account' }),
})
```

After success, refresh the employee list so the account disappears from active employees.

- [ ] **Step 4: Ensure the module loads explicitly and only once**

Prefer the existing isolated module approach already used by the portal. If keeping esbuild `inject`, verify the file executes as a side effect in the final bundle; otherwise import/install explicitly from `frontend/src/main.jsx`.

- [ ] **Step 5: Run browser E2E**

```bash
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: all owner/admin/protected/delete cases pass on configured desktop/iPhone/Android projects.

- [ ] **Step 6: Commit**

```bash
git add frontend/src scripts/build-frontend.mjs tests/e2e/employee-role-management.spec.mjs
git commit -m "feat: manage active employee roles and accounts"
```

---

### Task 6: Full regression verification and production handoff

**Files:**
- Modify: `package.json` only if test wiring still needs reconciliation.
- Verify all feature files and current-main attendance/worksite behavior.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: merge-ready branch and healthy Netlify production deploy.

- [ ] **Step 1: Run focused checks**

```bash
node scripts/employee-role-management-test.mjs
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 2: Run complete project verification**

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: all commands exit 0; no attendance/worksite regression from PR #34.

- [ ] **Step 3: Review the final diff against the approved design**

Confirm:

```text
owner: employee/manager/admin role changes + permitted deletion
admin: employee/manager role changes + employee/manager deletion
admin: no Admin assignment/change/delete
owner account: no role/delete action
manager/employee: no account-management writes
portal-access + schedule_employees synchronized
deactivated record cannot fall back to stale Identity role
```

- [ ] **Step 4: Merge only after green verification**

Merge the refreshed feature PR to `main`.

- [ ] **Step 5: Verify Netlify production deploy**

Confirm the deploy is `ready`, points at the merge commit, and includes the updated `registrations` function and frontend bundle.

- [ ] **Step 6: Live smoke test**

On the production portal as Hauptadmin:

```text
Mitarbeiter -> active employee -> role selector visible
Mitarbeiter -> employee -> Admin role option visible only for Hauptadmin
Mitarbeiter -> existing Admin -> Hauptadmin can edit/delete
Normal Admin -> existing Admin -> protected/no controls
Normal Admin -> employee -> Mitarbeiter/Einsatzleiter controls visible
```
