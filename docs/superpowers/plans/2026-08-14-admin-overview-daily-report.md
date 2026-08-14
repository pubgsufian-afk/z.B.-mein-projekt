# Admin Overview and Daily Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two unhelpful overview shortcuts with a polished admin-only Einsatz-Zentrale and a lightweight daily-report workflow while preserving the existing Zeiten and Berichte pages.

**Architecture:** Keep the existing React portal intact and add a focused `AdminOverview` component plus small utility module. A deterministic build-time patch swaps only the existing `OverviewPage` implementation, matching the repository's existing apply-script pattern. Daily reports use a new admin-only Netlify Function backed by a dedicated Netlify Blobs store.

**Tech Stack:** React 19, Netlify Functions, Netlify Identity, Netlify Blobs, Node source-contract tests, existing CSS design system.

## Global Constraints

- `Einsatz-Zentrale` and `Tagesbericht` are visible only to `owner` and `admin`.
- `manager` and `employee` cannot read or write daily reports through the API.
- Daily reports contain text only, maximum 1,000 words, with server-generated author and timestamp metadata.
- No AI, photos, or autosave.
- Existing `Zeiten`, PDF/Excel `Berichte`, attendance logic, schedule logic, navigation, and original logo remain unchanged.
- Mobile layout follows the approved dark/gold mockup and names are collapsed until a status group is tapped.

---

### Task 1: Contract tests

**Files:**
- Create: `scripts/admin-overview-daily-report-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: repository source files.
- Produces: a verification command that fails before the feature exists and passes only when UI, role guards, API and patch wiring exist.

- [ ] **Step 1: Write the failing source-contract test**
- [ ] **Step 2: Run CI/verification and confirm RED because the feature files/markers are absent**

### Task 2: Admin overview UI

**Files:**
- Create: `frontend/src/AdminOverview.jsx`
- Create: `frontend/src/admin-overview-utils.mjs`
- Create: `frontend/src/admin-overview.css`
- Create: `scripts/apply-admin-overview-daily-report.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `session`, `navigate`, `/api/schedule-v2?resource=entries`, `/api/attendance?resource=live`, `/api/daily-reports`.
- Produces: responsive admin dashboard, collapsed status groups, daily-report compose/list dialogs.

- [ ] **Step 1: Add pure grouping and Berlin-date helpers**
- [ ] **Step 2: Build `AdminOverview` with admin-only command center and Tagesbericht**
- [ ] **Step 3: Add faithful dark/gold responsive CSS**
- [ ] **Step 4: Add deterministic App.jsx patch and wire it into verification/build**

### Task 3: Daily-report API

**Files:**
- Create: `netlify/functions/daily-reports.mts`

**Interfaces:**
- Consumes: authenticated Netlify Identity actor and `portal-access` profile data.
- Produces: `GET /api/daily-reports` and `POST /api/daily-reports` for owner/admin only; store `portal-daily-reports`.

- [ ] **Step 1: Enforce owner/admin roles with `requirePortalRole`**
- [ ] **Step 2: Validate non-empty text and 1,000-word maximum**
- [ ] **Step 3: Save only server-generated author metadata, timestamp and text**
- [ ] **Step 4: Return reports newest-first**

### Task 4: Verification and release

**Files:**
- No new production files unless verification finds a defect.

**Interfaces:**
- Consumes: pull-request CI, Netlify deploy preview/production deploy.
- Produces: tested production release.

- [ ] **Step 1: Run full GitHub verification/build/e2e on the feature PR**
- [ ] **Step 2: Inspect the deploy/rendered mobile overview and core interactions**
- [ ] **Step 3: Fix any regressions and re-run CI**
- [ ] **Step 4: Merge to `main` and deploy the existing Netlify site**
- [ ] **Step 5: Verify production deploy is ready and the new function is present**
