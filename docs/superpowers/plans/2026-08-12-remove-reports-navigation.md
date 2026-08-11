# Remove Reports Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible **„Berichte“** item from the final management sidebar while keeping Stundenzettel PDF/Excel and Stempelprotokoll export/comparison unchanged.

**Architecture:** This repository builds the final portal through an ordered patch/finalizer pipeline. The raw `frontend/src/App.jsx` is an intermediate source and may still contain the legacy `reports` entry before finalizers run. Therefore the removal belongs in `scripts/apply-independent-timesheet-ui.mjs`, the finalizer that also creates the separate Stundenzettel/Stempelprotokoll navigation. A dedicated regression contract runs immediately after that finalizer through `scripts/verify-timesheet-monthly-freeze.mjs`.

**Tech Stack:** React 19, Node.js ESM patch/verification scripts, Playwright, GitHub Actions, Netlify build pipeline.

## Global Constraints

- Remove only the visible main-navigation entry **„Berichte“** from the final built portal.
- Keep Stundenzettel PDF/Excel downloads unchanged.
- Keep Stempelprotokoll export/comparison unchanged.
- Keep existing report page/function code and API endpoints available for other callers.
- Do not change database schema or data.
- Do not publish until the normal PR verification, build, browser tests, and preview are green.

---

## File Structure

- Modify `scripts/apply-independent-timesheet-ui.mjs`: after adding the separate Stundenzettel/Stempelprotokoll navigation, remove the legacy `reports` navigation object.
- Create `scripts/reports-navigation-hidden-test.mjs`: verify final navigation has no `reports`/`Berichte` item and verify both remaining export routes are still present.
- Modify `scripts/verify-timesheet-monthly-freeze.mjs`: run the regression contract after `apply-independent-timesheet-ui.mjs` and its existing separation checks.
- No Netlify Function or database file is modified for this feature.

---

### Task 1: Add the final-state regression contract

**Files:**
- Create: `scripts/reports-navigation-hidden-test.mjs`

- [x] **Step 1: Add a contract that reads final `App.jsx`, `TimesheetMonthlyPage.jsx`, and `TimesheetPage.jsx`.**

The contract asserts:

```js
assert.doesNotMatch(navigation, /key:\s*['"]reports['"]/, 'reports must not be in main navigation')
assert.doesNotMatch(navigation, /label:\s*['"]Berichte['"]/, 'Berichte must not be in main navigation')
assert.match(timesheet, /\/api\/timesheet-reports/, 'Stundenzettel PDF\/Excel must stay available')
assert.match(stampLog, /\/api\/stamp-comparison-reports/, 'Stempelprotokoll export\/comparison must stay available')
```

- [x] **Step 2: Run the existing portal patch chain through the monthly finalizer and confirm RED.**

Expected and observed: the preparation succeeds and the new contract fails specifically with `reports must not be in main navigation`.

---

### Task 2: Remove the reports item at the correct finalizer boundary

**Files:**
- Modify: `scripts/apply-independent-timesheet-ui.mjs`
- Modify: `scripts/verify-timesheet-monthly-freeze.mjs`

- [x] **Step 1: Define the exact legacy reports navigation row and remove it during the finalizer.**

```js
const reportsNav = "  { key: 'reports', label: 'Berichte', roles: ['owner', 'admin', 'manager'] },"
app = app.replace(`${reportsNav}\n`, '')
```

This runs after the Stundenzettel navigation is located and after Stempelprotokoll is inserted, so the final navigation contains both required work areas but no standalone Berichte item.

- [x] **Step 2: Append the regression contract to `verify-timesheet-monthly-freeze.mjs`.**

```js
await import('./reports-navigation-hidden-test.mjs')
```

- [x] **Step 3: Re-run the focused final-state check and confirm GREEN.**

Observed: finalizer preparation and the focused reports-navigation contract both pass.

---

### Task 3: Normal PR verification and release readiness

**Files:**
- No further product changes expected.

- [ ] **Step 1: Remove the temporary branch-only GitHub Actions test workflow used for TDD.**

- [ ] **Step 2: Open PR `Remove reports from sidebar navigation` against `main`.**

PR body:

```text
Removes only the visible “Berichte” sidebar item from the final built navigation. Stundenzettel PDF/Excel and Stempelprotokoll export/comparison remain unchanged. No database or report-endpoint changes.
```

- [ ] **Step 3: Require the repository's normal PR verification/build/browser checks to pass.**

The standard workflow must run the repository verification, production build, and configured Playwright tests.

- [ ] **Step 4: Require the normal Netlify preview to succeed.**

Do not trigger additional manual previews.

- [ ] **Step 5: Review the final PR diff.**

Expected functional changes:

```text
scripts/apply-independent-timesheet-ui.mjs
scripts/reports-navigation-hidden-test.mjs
scripts/verify-timesheet-monthly-freeze.mjs
```

Documentation changes under `docs/superpowers/` are expected. There must be no feature-specific changes under `netlify/functions/` or `netlify/database/`.

- [ ] **Step 6: Do not merge or deploy production until all checks are green and the branch completion step is approved.**
