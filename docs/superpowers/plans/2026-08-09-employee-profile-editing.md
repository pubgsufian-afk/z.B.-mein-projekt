# Mitarbeiterprofile bearbeiten – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Hauptadmin kann bei aktiven Konten Namen, Firma und Einsatzort bearbeiten, einschließlich des eigenen Profils, ohne den Schutz vor Herabstufung oder Deaktivierung aufzuheben.

**Architecture:** Die bestehende Mitarbeiterverwaltung bleibt die zentrale Oberfläche. `/api/registrations` erhält die getrennte Aktion `update-profile`; die bestehende serverseitige Policy unterscheidet dabei Profiländerungen von Rollen-/Deaktivierungsaktionen. Die vorhandene automatische Mitarbeiterkarten-Erweiterung zeigt nur für `owner` einen Profil-Editor und lädt die Daten nach erfolgreichem Speichern neu.

**Tech Stack:** React 19, Vanilla DOM enhancement, Netlify Functions (TypeScript/MTS), Netlify Blobs, Neon schedule repository, Node assert tests, Playwright E2E.

## Global Constraints

- `owner` darf Profildaten aller aktiven Konten bearbeiten, auch die eigenen.
- `update-profile` darf Rolle, Aktivstatus oder Hauptadmin-Schutz nicht verändern.
- Das eigene Hauptadmin-Konto bleibt gegen Herabstufung, Deaktivierung und Löschung geschützt.
- Geänderte `fullName`-/`location`-Werte werden in die Dienstplan-Mitarbeiterquelle synchronisiert.
- Leere Namen werden serverseitig abgelehnt.
- Passwort- und Authentifizierungsdaten sind nicht Teil dieser Änderung.
- Das visuelle Grunddesign des Portals bleibt unverändert.

---

### Task 1: Serverseitige Profilbearbeitung und Schutzregeln

**Files:**
- Modify: `netlify/functions/_shared/employee-management-policy.mts`
- Modify: `netlify/functions/registrations.mts`
- Test: `scripts/employee-role-management-policy-test.mjs`

**Interfaces:**
- Consumes: `employeeManagementPolicy({ actorRole, actorUserId, targetRole, targetUserId, action, requestedRole? })`
- Produces: `EmployeeManagementAction = 'update-role' | 'deactivate-account' | 'update-profile'`
- Produces: `PATCH /api/registrations` body `{ id, action: 'update-profile', fullName, company, location }`

- [ ] **Step 1: Write failing policy/source assertions**

Extend `scripts/employee-role-management-policy-test.mjs` with assertions equivalent to:

```js
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-profile' }), true)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'update-profile' }), true)
assert.equal(allowed({ actorRole: 'admin', actorUserId: 'admin-1', targetRole: 'employee', targetUserId: 'employee-1', action: 'update-profile' }), false)
assert.equal(allowed({ actorRole: 'owner', actorUserId: 'owner-1', targetRole: 'owner', targetUserId: 'owner-1', action: 'deactivate-account' }), false)
assert.match(registrations, /update-profile/)
assert.match(registrations, /fullName/)
assert.match(registrations, /upsertScheduleEmployee/)
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node scripts/employee-role-management-policy-test.mjs
```

Expected: FAIL because `update-profile` is not yet supported.

- [ ] **Step 3: Update the policy minimally**

Implement `update-profile` as an owner-only action before the existing protected-target block:

```ts
export type EmployeeManagementAction = 'update-role' | 'deactivate-account' | 'update-profile'

if (input.action === 'update-profile') {
  if (input.actorRole !== 'owner') {
    return { allowed: false, status: 403, message: 'Nur Hauptadmin darf Mitarbeiterdaten bearbeiten.' }
  }
  return { allowed: true, status: 200, message: '' }
}
```

Then preserve the existing rules for `update-role` and `deactivate-account`, including self-owner protection.

- [ ] **Step 4: Implement `update-profile` in `/api/registrations`**

Accept the action in `manageActiveEmployee`, validate `fullName.trim()` is non-empty, normalize `company` and `location`, preserve `role` and `status`, save the merged record to `portal-access`, and synchronize the schedule employee:

```ts
if (action === 'update-profile') {
  const fullName = String(body.fullName || '').trim();
  const company = String(body.company || '').trim();
  const location = String(body.location || '').trim();
  if (!fullName) return json({ message: 'Der Name darf nicht leer sein.' }, 400);

  const employee: AccessRecord = {
    ...target,
    userId: String(target.userId || id),
    fullName,
    company,
    location,
    grantedAt: now,
    grantedBy: access.current.userId,
  };
  await store.setJSON(key, employee);
  await upsertScheduleEmployee({
    userId: employee.userId!,
    fullName,
    role: effectiveTargetRole as ScheduleEmployee['role'],
    status: 'active',
    location,
  });
  return json({ ok: true, employee });
}
```

Do not modify `role` or `status` from the request body.

- [ ] **Step 5: Run focused verification**

Run:

```bash
node scripts/employee-role-management-policy-test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit backend change**

```bash
git add netlify/functions/_shared/employee-management-policy.mts netlify/functions/registrations.mts scripts/employee-role-management-policy-test.mjs
git commit -m "feat: allow owner to edit employee profiles"
```

---

### Task 2: Hauptadmin-Profil-Editor auf Mitarbeiterkarten

**Files:**
- Modify: `frontend/src/employee-role-management-auto.js`
- Test: `tests/e2e/employee-role-management.spec.mjs`

**Interfaces:**
- Consumes: employee records returned by `GET /api/registrations` with `userId`, `fullName`, `company`, `location`, `role`, `status`.
- Produces: UI action **Daten bearbeiten** only for `currentSession.role === 'owner'`.
- Produces: `PATCH /api/registrations` with `{ id, action: 'update-profile', fullName, company, location }`.

- [ ] **Step 1: Extend the Playwright mock and write failing UI tests**

Update `mockPortal` so a successful `update-profile` mutates the mocked employee data. Add tests for:

```js
test('Hauptadmin can edit employee profile data', async ({ page }) => {
  const portal = await openEmployees(page, 'owner')
  await page.getByRole('button', { name: 'Daten bearbeiten' }).click()
  await page.getByLabel('Name für Adel Abdal').fill('Adel Neu')
  await page.getByLabel('Firma für Adel Abdal').fill('Habun Security')
  await page.getByLabel('Einsatzort für Adel Abdal').fill('GMB')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => portal.getLastPatch()).toMatchObject({
    id: 'employee-adel', action: 'update-profile', fullName: 'Adel Neu', company: 'Habun Security', location: 'GMB'
  })
})

test('Hauptadmin can edit own profile but remains protected from deactivation', async ({ page }) => {
  // targetId is owner-role-test
  // expect Daten bearbeiten visible
  // expect Konto deaktivieren absent
})

test('normal Admin has no profile edit action', async ({ page }) => {
  await openEmployees(page, 'admin')
  await expect(page.getByRole('button', { name: 'Daten bearbeiten' })).toHaveCount(0)
})
```

- [ ] **Step 2: Run the employee management E2E test and verify failure**

Run:

```bash
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: new profile-edit tests FAIL because the editor does not exist yet.

- [ ] **Step 3: Add the profile editor without changing the base card design**

In `addEditor`, create a separate owner-only profile block before the role protection early-return. This is essential so the owner can edit their own profile even when role/deactivation controls are protected.

The editor should:

```js
if (currentSession.role === 'owner') {
  // button: Daten bearbeiten
  // hidden/edit mode fields: fullName, company, location
  // buttons: Speichern, Abbrechen
  // PATCH action update-profile
  // after success: toast + await refresh()
}
```

Use accessible labels:

```js
`Name für ${employee.fullName}`
`Firma für ${employee.fullName}`
`Einsatzort für ${employee.fullName}`
```

Keep the existing `Hauptadmin ist geschützt.` note and absence of role/deactivation controls for the owner account.

- [ ] **Step 4: Run focused E2E verification**

Run:

```bash
npx playwright test tests/e2e/employee-role-management.spec.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit frontend and E2E change**

```bash
git add frontend/src/employee-role-management-auto.js tests/e2e/employee-role-management.spec.mjs
git commit -m "feat: add owner employee profile editor"
```

---

### Task 3: Full verification, integration and production deployment

**Files:**
- Verify only; no additional source files expected unless a test exposes a regression.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: production-ready commit on `main` and Netlify deployment for `habun-mitarbeiterportal`.

- [ ] **Step 1: Run full project verification**

```bash
npm run verify:all
npm run build:frontend
```

Expected: both commands PASS.

- [ ] **Step 2: Run portal E2E suite**

```bash
npm run test:e2e
```

Expected: all configured Playwright portal tests PASS.

- [ ] **Step 3: Review diff for scope and protection guarantees**

Confirm the diff contains only the profile-edit feature, tests, and plan/spec docs. Confirm no request path allows `update-profile` to change `role` or `status`, and owner self-deactivation remains blocked.

- [ ] **Step 4: Merge the feature branch into `main`**

Use a PR/squash or fast-forward only after all checks pass.

- [ ] **Step 5: Verify Netlify production deploy**

Confirm the `habun-mitarbeiterportal` production deployment is `ready`, has no build error, and points to the merged commit.

- [ ] **Step 6: Production smoke check**

On the live portal, confirm the Hauptadmin employee page exposes **Daten bearbeiten** and keeps the own-account protection note. Do not alter real employee data during smoke verification unless an explicit reversible test value is available.
