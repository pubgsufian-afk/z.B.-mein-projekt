# Remove Reports Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible **„Berichte“** item from the management sidebar while keeping all PDF/Excel and stamp-comparison functionality available from Stundenzettel and Stempelprotokoll.

**Architecture:** Change only the navigation definition in `frontend/src/App.jsx`. Keep the existing reports page/function code and API endpoints untouched. Strengthen the existing `scripts/unified-portal-test.mjs`, which already runs after the portal patch pipeline, so any future patch that reintroduces the navigation item fails verification immediately.

**Tech Stack:** React 19, Node.js ESM verification scripts, Playwright, GitHub Actions, Netlify build pipeline.

## Global Constraints

- Remove only the visible main-navigation entry **„Berichte“**.
- Keep Stundenzettel PDF/Excel downloads unchanged.
- Keep Stempelprotokoll export/comparison unchanged.
- Do not delete report endpoints or database data.
- No database migration is required.
- Do not publish until `npm run verify`, `npm run build`, and `npm run test:e2e` are all green.
- Use the existing feature branch so intermediate work does not go directly to production.

---

## File Structure

- Modify `scripts/unified-portal-test.mjs`: assert that `reports`/`Berichte` is absent specifically from `NAVIGATION`, while Stundenzettel and Stempelprotokoll export routes remain present in their owning pages.
- Modify `frontend/src/App.jsx`: remove only `{ key: 'reports', label: 'Berichte', ... }` from `NAVIGATION`.
- No `package.json`, Netlify Function, or database changes are required.

---

### Task 1: Turn the existing portal test into the regression contract

**Files:**
- Modify: `scripts/unified-portal-test.mjs`

**Interfaces:**
- Consumes: `frontend/src/App.jsx`, `frontend/src/TimesheetMonthlyPage.jsx`, `frontend/src/TimesheetPage.jsx`
- Produces: a failing verification while `Berichte` remains in `NAVIGATION`, and a passing verification after only that navigation item is removed.

- [ ] **Step 1: Write the failing expectations**

Extend the existing `Promise.all` so the test also reads the two report-owning pages:

```js
const [index, app, styles, packageJson, registrations, timesheet, stampLog] = await Promise.all([
  readFile('public/index.html', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/styles.css', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('netlify/functions/registrations.mts', 'utf8'),
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
  readFile('frontend/src/TimesheetPage.jsx', 'utf8'),
])
```

Change the visible-label loop from:

```js
for (const label of ['Übersicht', 'Zeiterfassung', 'Mitarbeiter', 'Dienstplan', 'Stundenzettel', 'Einsatzorte', 'Berichte', 'Einstellungen']) {
  assert.match(app, new RegExp(label))
}
```

to:

```js
for (const label of ['Übersicht', 'Zeiterfassung', 'Mitarbeiter', 'Dienstplan', 'Stundenzettel', 'Stempelprotokoll', 'Einsatzorte', 'Einstellungen']) {
  assert.match(app, new RegExp(label))
}

const navigation = app.match(/const NAVIGATION = \[(.*?)\]\n/s)?.[1] || ''
assert.ok(navigation, 'NAVIGATION block must exist')
assert.doesNotMatch(navigation, /key:\s*['"]reports['"]/, 'reports must not be in main navigation')
assert.doesNotMatch(navigation, /label:\s*['"]Berichte['"]/, 'Berichte must not be in main navigation')
assert.match(timesheet, /\/api\/timesheet-reports/, 'Stundenzettel PDF\/Excel must stay available')
assert.match(stampLog, /\/api\/stamp-comparison-reports/, 'Stempelprotokoll export\/comparison must stay available')
```

This deliberately checks only the navigation block, so existing internal report code may still contain the word `Berichte` without failing the test.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
node scripts/unified-portal-test.mjs
```

Expected: FAIL with `reports must not be in main navigation` because the current `NAVIGATION` still contains `{ key: 'reports', label: 'Berichte', ... }`.

- [ ] **Step 3: Commit the RED test**

```bash
git add scripts/unified-portal-test.mjs
git commit -m "test: require reports navigation to stay hidden"
```

---

### Task 2: Remove only the reports navigation item

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: the existing `NAVIGATION` array.
- Produces: the same sidebar and role behavior minus the `reports` item.

- [ ] **Step 1: Remove the single navigation object**

Change:

```jsx
  { key: 'worksites', label: 'Einsatzorte', roles: ['owner', 'admin'] },
  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },
  { key: 'settings', label: 'Einstellungen', roles: ['owner', 'admin'] },
```

to:

```jsx
  { key: 'worksites', label: 'Einsatzorte', roles: ['owner', 'admin'] },
  { key: 'settings', label: 'Einstellungen', roles: ['owner', 'admin'] },
```

Do not remove the reports page component, report endpoints, export handlers, PDF/Excel buttons, or comparison functions.

- [ ] **Step 2: Run the focused test to verify GREEN**

Run:

```bash
node scripts/unified-portal-test.mjs
```

Expected: PASS with `Unified portal source tests passed`.

- [ ] **Step 3: Run unified verification to prove patch scripts do not restore it**

Run:

```bash
npm run verify:unified
```

Expected: PASS. `scripts/unified-portal-test.mjs` runs after the portal mutation/patch scripts in the existing `verify:unified` command, so this catches any patch that would silently restore the menu item.

- [ ] **Step 4: Commit the implementation**

```bash
git add frontend/src/App.jsx
git commit -m "ui: remove reports from sidebar navigation"
```

---

### Task 3: Full regression and release readiness

**Files:**
- Verify only; no additional source changes are part of this task.

**Interfaces:**
- Consumes: final feature-branch state.
- Produces: a reviewed branch ready for a PR against `main`.

- [ ] **Step 1: Run the full repository verification**

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run all configured browser regression tests**

```bash
npm run test:e2e
```

Expected: PASS on all configured browser/device scenarios.

- [ ] **Step 4: Review the final functional diff**

Expected functional files:

```text
frontend/src/App.jsx                 remove one NAVIGATION entry
scripts/unified-portal-test.mjs     add regression expectations
```

Confirm there are no changes under:

```text
netlify/functions/
netlify/database/
```

- [ ] **Step 5: Open a PR against `main`**

Use title:

```text
Remove reports from sidebar navigation
```

Use body:

```text
Removes only the visible “Berichte” sidebar item. Stundenzettel PDF/Excel and Stempelprotokoll export/comparison remain unchanged. No database or report-endpoint changes.
```

Do not merge until the PR verification/preview run is green.
