# Remove Reports Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible **„Berichte“** item from the management sidebar while keeping all PDF/Excel and stamp-comparison functionality available from Stundenzettel and Stempelprotokoll.

**Architecture:** Change only the navigation definition in `frontend/src/App.jsx`. Keep the existing reports page/function code and API endpoints untouched. Add a source contract test that runs after the portal patch pipeline so any future patch script that reintroduces the navigation item fails verification immediately.

**Tech Stack:** React 19, Node.js ESM verification scripts, Playwright, GitHub Actions, Netlify build pipeline.

## Global Constraints

- Remove only the visible main-navigation entry **„Berichte“**.
- Keep Stundenzettel PDF/Excel downloads unchanged.
- Keep Stempelprotokoll export/comparison unchanged.
- Do not delete report endpoints or database data.
- No database migration is required.
- Do not publish until the full `npm run verify`, `npm run build`, and `npm run test:e2e` checks are green.
- Use the existing feature branch so no intermediate change is pushed directly to production.

---

## File Structure

- Create `scripts/reports-navigation-hidden-test.mjs`: source-level regression contract that verifies the management navigation no longer contains `reports`/`Berichte` and verifies the two remaining report routes are still referenced by their owning pages.
- Modify `frontend/src/App.jsx`: remove only `{ key: 'reports', label: 'Berichte', ... }` from `NAVIGATION`.
- Modify `package.json`: append the new regression test to `verify:unified` after all patch scripts so a later patch cannot silently restore the menu item.
- No Netlify Function or database files are modified.

---

### Task 1: Add the navigation regression contract

**Files:**
- Create: `scripts/reports-navigation-hidden-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `frontend/src/App.jsx`, `frontend/src/TimesheetMonthlyPage.jsx`, `frontend/src/TimesheetPage.jsx`
- Produces: a zero-exit-status contract when `Berichte` is absent from `NAVIGATION` and both remaining report routes are still present.

- [ ] **Step 1: Write the failing test**

Create `scripts/reports-navigation-hidden-test.mjs` with:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [app, timesheet, stampLog] = await Promise.all([
  readFile('frontend/src/App.jsx', 'utf8'),
  readFile('frontend/src/TimesheetMonthlyPage.jsx', 'utf8'),
  readFile('frontend/src/TimesheetPage.jsx', 'utf8'),
])

const navigation = app.match(/const NAVIGATION = \[(.*?)\]\n/s)?.[1] || ''
assert.ok(navigation, 'NAVIGATION block must exist')
assert.doesNotMatch(navigation, /key:\s*['"]reports['"]/, 'reports must not be in main navigation')
assert.doesNotMatch(navigation, /label:\s*['"]Berichte['"]/, 'Berichte must not be in main navigation')

assert.match(timesheet, /\/api\/timesheet-reports/, 'Stundenzettel PDF\/Excel route must stay available')
assert.match(stampLog, /\/api\/stamp-comparison-reports/, 'Stempelprotokoll export\/comparison route must stay available')

console.log('reports navigation hidden contract passed')
```

Append the test to the end of the `verify:unified` command in `package.json`:

```json
"verify:unified": "... && node scripts/verify-timesheet-monthly-freeze.mjs && node scripts/reports-navigation-hidden-test.mjs"
```

- [ ] **Step 2: Run the new test to verify RED**

Run:

```bash
node scripts/reports-navigation-hidden-test.mjs
```

Expected: FAIL on the `reports must not be in main navigation` assertion because the current `NAVIGATION` still contains the reports item.

- [ ] **Step 3: Commit the RED contract**

```bash
git add scripts/reports-navigation-hidden-test.mjs package.json
git commit -m "test: require reports navigation to stay hidden"
```

---

### Task 2: Remove only the reports navigation item

**Files:**
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: the existing `NAVIGATION` array.
- Produces: the same navigation order and role behavior minus the `reports` item.

- [ ] **Step 1: Remove the single navigation object**

Change this section:

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

Do not delete the reports page component, report APIs, route handlers, or download buttons.

- [ ] **Step 2: Run the focused contract to verify GREEN**

Run:

```bash
node scripts/reports-navigation-hidden-test.mjs
```

Expected: PASS with `reports navigation hidden contract passed`.

- [ ] **Step 3: Run unified verification to ensure patch scripts do not reinsert it**

Run:

```bash
npm run verify:unified
```

Expected: PASS. Because the new contract is last in `verify:unified`, any earlier build/patch script that reintroduces `Berichte` will make this step fail.

- [ ] **Step 4: Commit the implementation**

```bash
git add frontend/src/App.jsx
git commit -m "ui: remove reports from sidebar navigation"
```

---

### Task 3: Full regression and release readiness

**Files:**
- No new source files unless a failing existing test requires an expectation update that reflects the approved design.

**Interfaces:**
- Consumes: final feature branch state.
- Produces: a branch safe to review/merge with no report-download regression.

- [ ] **Step 1: Run the full repository verification**

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: PASS and build artifacts generated normally.

- [ ] **Step 3: Run all browser regression tests**

```bash
npm run test:e2e
```

Expected: PASS on all configured browser/device scenarios.

- [ ] **Step 4: Review the final diff**

Confirm the functional diff contains only:

```text
frontend/src/App.jsx                         navigation item removed
scripts/reports-navigation-hidden-test.mjs  regression contract added
package.json                                 contract added to verify:unified
```

The spec/plan docs may also be present. Confirm there are no changes under `netlify/functions/` or `netlify/database/`.

- [ ] **Step 5: Open a PR against `main`**

Use title:

```text
Remove reports from sidebar navigation
```

PR body must state:

```text
Removes only the visible “Berichte” sidebar item. Stundenzettel PDF/Excel and Stempelprotokoll export/comparison remain unchanged. No database or report-endpoint changes.
```

Do not merge until the PR verification/preview run is green.
