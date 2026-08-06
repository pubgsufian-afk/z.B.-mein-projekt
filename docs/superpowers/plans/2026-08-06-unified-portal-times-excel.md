# Unified Portal Times and Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the portal's personal-hours and Excel-export capabilities while moving them into the single source-built portal defined by `2026-08-06-unified-portal-mobile-settings.md`.

**Architecture:** Add a dedicated role-aware Times page to the React application and a server-authorized Excel endpoint for management reports. Reuse the same report rows, employee filters, period filters, company settings, and permissions as the PDF report flow so the two exports cannot disagree.

**Tech Stack:** React 19, Netlify Functions, Neon PostgreSQL, ExcelJS, Playwright, Node test scripts.

## Global Constraints

- Work only on `fix/unified-portal-mobile-settings`.
- Do not merge or deploy without explicit user approval.
- Keep the existing black/gold palette and unchanged Habun logo.
- Employees see only their own hours and cannot download management reports.
- Managers, admins, and owners may create authorized PDF and Excel reports.
- Never expose employee ID or personal number.
- Excel and PDF totals must be calculated from the same normalized report rows.

---

### Task 1: Dedicated Times Page

**Files:**
- Create: `frontend/src/features/times/TimesPage.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/app/roles.js`
- Modify: `frontend/src/styles.css`
- Test: `tests/e2e/portal.spec.mjs`

**Interfaces:**
- Employee request: `GET /api/attendance?resource=history&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Management request: same endpoint with authorized employee filter where supported.
- Page key: `times`.

- [ ] **Step 1: Write failing employee-scope test**

```js
test('employee sees only personal hours on the Times page', async ({ page }) => {
  await loginAsEmployee(page)
  await page.getByRole('button', { name: 'Meine Zeiten', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Meine Zeiten', exact: true })).toBeVisible()
  await expect(page.getByText('Anna Beispiel')).toBeVisible()
  await expect(page.getByText('Bernd Muster')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /PDF|Excel/ })).toHaveCount(0)
})
```

- [ ] **Step 2: Run test and verify failure**

Run: `npx playwright test tests/e2e/portal.spec.mjs -g "personal hours"`

- [ ] **Step 3: Implement the Times page**

Render period controls, daily entries, clock-in, pause periods, clock-out, net duration, work site, and correction status. Employees have no download buttons. Management may inspect authorized employees but report downloads remain in Reports.

- [ ] **Step 4: Verify mobile layout**

At mobile width, render entries as cards rather than a full-width table. Confirm no horizontal page overflow.

- [ ] **Step 5: Run tests and commit**

```bash
npx playwright test tests/e2e/portal.spec.mjs --project=desktop-chromium
npx playwright test tests/e2e/portal.spec.mjs --project=iphone-chromium
git add frontend/src/features/times frontend/src/App.jsx frontend/src/app/roles.js frontend/src/styles.css tests/e2e/portal.spec.mjs
git commit -m "feat: add dedicated personal times page"
```

---

### Task 2: Shared Report Rows for PDF and Excel

**Files:**
- Create: `netlify/functions/_shared/report-rows.mts`
- Modify: `netlify/functions/reports-v2.mts`
- Test: `scripts/report-rows-test.mjs`

**Interfaces:**
- `groupReportRows(events, schedules): ReportRow[]`
- `summarizeReportRows(rows): { monthly, employeeTotals, grandTotal }`
- `ReportRow` includes employee name, date, planned times, actual times, break minutes, net minutes, location, and warning.

- [ ] **Step 1: Write failing shared-row test**

```js
const rows = groupReportRows(events, schedules)
const summary = summarizeReportRows(rows)
assert.equal(rows[0].breakMinutes, 30)
assert.equal(rows[0].netMinutes, 450)
assert.equal(summary.grandTotal, 450)
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/report-rows-test.mjs`

- [ ] **Step 3: Move normalization out of the PDF function**

Both exports must import the exact same helpers. Do not duplicate duration or summary calculations.

- [ ] **Step 4: Run PDF and shared-row tests**

```bash
node scripts/report-rows-test.mjs
node scripts/pdf-branding-test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/report-rows.mts netlify/functions/reports-v2.mts scripts/report-rows-test.mjs
git commit -m "refactor: share report calculations"
```

---

### Task 3: Authorized Excel Report Endpoint

**Files:**
- Create: `netlify/functions/reports-excel-v2.mts`
- Modify: `package.json`
- Modify: `netlify.toml`
- Test: `scripts/excel-report-test.mjs`

**Interfaces:**
- `POST /api/reports-excel-v2` with `{ from, to, userIds, reportType }`.
- Response content type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

- [ ] **Step 1: Add ExcelJS dependency**

```json
{
  "dependencies": {
    "exceljs": "^4.4.0"
  }
}
```

- [ ] **Step 2: Write failing permission and workbook tests**

```js
assert.equal(employeeResponse.status, 403)
assert.equal(adminResponse.status, 200)
assert.match(adminResponse.headers.get('content-type'), /spreadsheetml/)
assert.ok((await adminResponse.arrayBuffer()).byteLength > 1000)
```

- [ ] **Step 3: Run and verify failure**

Run: `node scripts/excel-report-test.mjs`

- [ ] **Step 4: Implement workbook generation**

Create sheets `Arbeitszeiten` and `Summen`. Add company name, phone, email, report period, and creation date above the table. Use the shared rows from Task 2. Do not add employee IDs or signatures.

- [ ] **Step 5: Run focused tests**

```bash
node scripts/excel-report-test.mjs
node scripts/report-rows-test.mjs
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json netlify.toml netlify/functions/reports-excel-v2.mts scripts/excel-report-test.mjs
git commit -m "feat: add authorized Excel reports"
```

---

### Task 4: Add Excel Download to Reports Page

**Files:**
- Modify: `frontend/src/features/reports/ReportsPage.jsx`
- Modify: `frontend/src/app/api.js`
- Test: `tests/e2e/settings-and-pdf.spec.mjs`

**Interfaces:**
- `apiBlob()` extracts a safe filename from `Content-Disposition`.
- `Excel herunterladen` posts the same selection used for the PDF preview.

- [ ] **Step 1: Write failing browser test**

```js
test('management downloads Excel for the selected report', async ({ page }) => {
  await loginAsAdmin(page)
  await page.getByRole('button', { name: 'Berichte', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Excel herunterladen' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i)
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx playwright test tests/e2e/settings-and-pdf.spec.mjs -g "Excel"`

- [ ] **Step 3: Implement the download button**

Disable the button while generating, show a German error without clearing the filters, and use the same employee IDs and date period as the PDF flow.

- [ ] **Step 4: Run report browser tests**

```bash
npx playwright test tests/e2e/settings-and-pdf.spec.mjs --project=desktop-chromium
npx playwright test tests/e2e/settings-and-pdf.spec.mjs --project=iphone-chromium
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/reports/ReportsPage.jsx frontend/src/app/api.js tests/e2e/settings-and-pdf.spec.mjs
git commit -m "feat: expose Excel download in reports"
```

---

### Task 5: Include Times and Excel in Full Verification

**Files:**
- Modify: `scripts/attendance-v2-verify.mjs`
- Modify: `package.json`
- Modify: `docs/verification/unified-portal-report.md`

- [ ] **Step 1: Add the new Node tests to verification**

Require `report-rows-test.mjs`, `excel-report-test.mjs`, and the Times page source in the verification script.

- [ ] **Step 2: Run all checks**

```bash
npm run verify
npm run build
npm run test:e2e
```

- [ ] **Step 3: Record evidence**

The verification report must record that employees cannot download files, management can download PDF and Excel, both exports use the same totals, and the Times page is usable on desktop, iPhone, and Android.

- [ ] **Step 4: Commit and stop before release**

```bash
git add scripts/attendance-v2-verify.mjs package.json docs/verification/unified-portal-report.md
git commit -m "test: verify times and Excel reporting"
```

Do not merge or deploy.
