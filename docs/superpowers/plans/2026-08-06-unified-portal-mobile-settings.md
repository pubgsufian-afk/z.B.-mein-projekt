# Unified Habun Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated modal attendance experience with one source-built Habun portal whose functions are distributed across the existing navigation, whose mobile schedule workflow is easy to use, and whose PDFs automatically contain the saved company logo and contact details.

**Architecture:** Stop treating the minified production bundle plus DOM patch scripts as the application source. Build one React application from `frontend/src`, keep the existing Netlify Identity, Neon attendance/schedule APIs, and black-gold design tokens, and expose each feature as a normal routed portal page. Store company settings in Netlify Blobs through a server-side API, reuse them in the PDF generator, and extend attendance events to support explicit pause start/end while preserving auditability.

**Tech Stack:** React 19, React DOM 19, esbuild, JavaScript/JSX ES modules, Netlify Functions, Netlify Identity, Netlify Blobs, Neon PostgreSQL, pdf-lib, Playwright, Node test scripts.

## Global Constraints

- Work only on `fix/unified-portal-mobile-settings`.
- Do not merge, deploy, or change the live Netlify site without explicit user approval.
- Keep the existing Habun logo unchanged unless an authorized admin uploads a replacement through Settings.
- Keep the existing black and gold color palette; do not introduce the white/blue colors from the reference images.
- Render one portal shell and one navigation only.
- Remove the visible `Neue Zeiterfassung` launcher and the modal `Zeiterfassung und Planung` shell.
- Keep employee technical user IDs internal; never show employee ID or personal number in the UI or PDFs.
- Employees may access only their own attendance, schedule, and correction data.
- Managers may plan shifts and review attendance/corrections, but may not grant owner/admin rights.
- Admins and owners may manage employees, work sites, company settings, and reports.
- Save company name, phone, email, and logo once in Settings and use them automatically in every new PDF.
- Mobile pages must work at 375 × 812 and 360 × 800 without horizontal page scrolling.
- Every task must begin with a failing test and end with passing focused tests plus a commit.

---

## File Structure

### Build and shell

- Create `frontend/src/main.jsx` — mounts the single React application.
- Replace `frontend/src/App.jsx` — authentication, session loading, role-aware navigation, and page selection only.
- Create `frontend/src/app/api.js` — authenticated JSON/blob request helpers.
- Create `frontend/src/app/roles.js` — role labels and permission helpers.
- Create `frontend/src/components/PortalShell.jsx` — desktop sidebar, mobile header/drawer, and content container.
- Create `scripts/build-frontend.mjs` — bundles JSX to `public/assets/habun-portal.js`.
- Modify `scripts/build.mjs` — runs the frontend bundle before copying `public` to `dist`.
- Modify `public/index.html` — loads only the unified portal bundle and required CSS/assets.

### Feature pages

- Create `frontend/src/features/overview/OverviewPage.jsx`.
- Create `frontend/src/features/attendance/AttendancePage.jsx`.
- Create `frontend/src/features/attendance/attendance-state.js`.
- Create `frontend/src/features/schedule/SchedulePage.jsx`.
- Create `frontend/src/features/schedule/ScheduleEditor.jsx`.
- Create `frontend/src/features/schedule/schedule-model.js`.
- Create `frontend/src/features/employees/EmployeesPage.jsx`.
- Create `frontend/src/features/worksites/WorksitesPage.jsx`.
- Create `frontend/src/features/corrections/CorrectionsPage.jsx`.
- Create `frontend/src/features/reports/ReportsPage.jsx`.
- Create `frontend/src/features/settings/SettingsPage.jsx`.
- Replace `frontend/src/styles.css` — retains current black/gold tokens and adds responsive components.

### Server and storage

- Modify `netlify/functions/attendance.mts` — accepts pause events and returns pause-aware state.
- Modify `netlify/functions/_shared/attendance-domain.mts` — validates four attendance transitions.
- Create `netlify/functions/_shared/company-settings.mts` — typed company settings read/write helpers.
- Replace `netlify/functions/settings.mts` — direct authenticated GET/PUT endpoint using Netlify Blobs.
- Modify `netlify/functions/reports-v2.mts` — reads saved company settings and embeds logo/contact data.
- Create `migrations/20260806_attendance_break_events.sql` — expands the attendance action constraint safely.

### Tests

- Create `scripts/unified-shell-test.mjs`.
- Create `scripts/attendance-pause-test.mjs`.
- Create `scripts/company-settings-test.mjs`.
- Create `scripts/pdf-branding-test.mjs`.
- Replace `tests/e2e/portal.spec.mjs` with unified-portal flows.
- Create `tests/e2e/mobile-schedule.spec.mjs`.
- Create `tests/e2e/settings-and-pdf.spec.mjs`.
- Modify `playwright.config.mjs` to include desktop Chromium, iPhone Chromium, and Android Chromium profiles.
- Modify `scripts/attendance-v2-verify.mjs` and `package.json` to run the new suites.

---

### Task 1: Build One Source-Controlled React Portal

**Files:**
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/app/api.js`
- Create: `frontend/src/app/roles.js`
- Create: `frontend/src/components/PortalShell.jsx`
- Replace: `frontend/src/App.jsx`
- Create: `scripts/build-frontend.mjs`
- Modify: `scripts/build.mjs`
- Modify: `package.json`
- Modify: `public/index.html`
- Test: `scripts/unified-shell-test.mjs`

**Interfaces:**
- `apiJson(path, options): Promise<object>`
- `apiBlob(path, options): Promise<{ blob: Blob, filename: string }>`
- `can(role, capability): boolean`
- `<PortalShell page onNavigate session onLogout children />`

- [ ] **Step 1: Write a failing shell test**

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile('public/index.html', 'utf8')
assert.match(html, /habun-portal\.js/)
assert.doesNotMatch(html, /attendance-v2\.js|attendance-v2-compat\.js/)
assert.doesNotMatch(html, /Neue Zeiterfassung/)
console.log('Unified shell test passed')
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node scripts/unified-shell-test.mjs`

Expected: FAIL because `public/index.html` still loads the modal attendance scripts and the unified bundle does not exist.

- [ ] **Step 3: Add React build dependencies and script**

Add exact dependencies:

```json
{
  "dependencies": {
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "scripts": {
    "build:frontend": "node scripts/build-frontend.mjs"
  }
}
```

Implement `scripts/build-frontend.mjs` with esbuild:

```js
import { build } from 'esbuild'

await build({
  entryPoints: ['frontend/src/main.jsx'],
  outfile: 'public/assets/habun-portal.js',
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
})
```

- [ ] **Step 4: Implement the single portal entry and shell**

`frontend/src/main.jsx` must mount only one application:

```jsx
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(<App />)
```

`PortalShell` must render one sidebar/drawer and one `<main>` content region. Mobile drawer buttons call `onNavigate(key)` and close the drawer immediately. Page state remains unchanged until a navigation button is selected.

- [ ] **Step 5: Remove legacy visible boot scripts from `public/index.html`**

Keep manifest, icons, logo, theme meta tags, and the unified stylesheet/bundle. Remove all UI scripts that create or patch a second portal, including `attendance-v2.js`, `attendance-v2-compat.js`, `schedule-v2.js`, `reports-v2.js`, `worksite-v2.js`, and the launcher scripts. Server functions remain untouched.

- [ ] **Step 6: Build and run focused tests**

Run:

```bash
npm install --no-audit --no-fund
npm run build:frontend
node scripts/unified-shell-test.mjs
```

Expected: PASS and `public/assets/habun-portal.js` exists.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/build-frontend.mjs scripts/build.mjs public/index.html frontend/src

git commit -m "refactor: build one unified portal shell"
```

---

### Task 2: Add Role-Aware Navigation and Stable Settings Page Routing

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/app/roles.js`
- Modify: `frontend/src/components/PortalShell.jsx`
- Create: `frontend/src/features/overview/OverviewPage.jsx`
- Test: `tests/e2e/portal.spec.mjs`

**Interfaces:**
- Capabilities: `viewOwnAttendance`, `manageSchedule`, `manageEmployees`, `manageWorksites`, `reviewCorrections`, `createReports`, `manageSettings`.
- Navigation keys: `overview`, `attendance`, `employees`, `schedule`, `times`, `worksites`, `corrections`, `reports`, `settings`.

- [ ] **Step 1: Write failing role/navigation E2E tests**

```js
test('settings opens as a normal page and remains selected', async ({ page }) => {
  await loginAsAdmin(page)
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /Zeiterfassung und Planung/ })).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible()
})

test('employee cannot see admin navigation', async ({ page }) => {
  await loginAsEmployee(page)
  await expect(page.getByRole('button', { name: 'Einstellungen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Mitarbeiter' })).toHaveCount(0)
})
```

- [ ] **Step 2: Run the two tests and verify failure**

Run: `npx playwright test tests/e2e/portal.spec.mjs --project=desktop-chromium`

- [ ] **Step 3: Implement exact capability map**

```js
export const ROLE_CAPABILITIES = {
  employee: new Set(['viewOwnAttendance']),
  manager: new Set(['viewOwnAttendance', 'manageSchedule', 'reviewCorrections', 'createReports']),
  admin: new Set(['viewOwnAttendance', 'manageSchedule', 'manageEmployees', 'manageWorksites', 'reviewCorrections', 'createReports', 'manageSettings']),
  owner: new Set(['viewOwnAttendance', 'manageSchedule', 'manageEmployees', 'manageWorksites', 'reviewCorrections', 'createReports', 'manageSettings']),
  pending: new Set(),
}
```

- [ ] **Step 4: Route each navigation key to one page component**

Do not open dialogs for navigation. Settings must render in the same `<main>` region. Unknown/forbidden pages fall back to `overview`.

- [ ] **Step 5: Verify desktop and mobile navigation**

Run:

```bash
npx playwright test tests/e2e/portal.spec.mjs --project=desktop-chromium
npx playwright test tests/e2e/portal.spec.mjs --project=iphone-chromium
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src tests/e2e/portal.spec.mjs

git commit -m "feat: add stable role-aware portal navigation"
```

---

### Task 3: Modern Digital Attendance With Pause Events

**Files:**
- Create: `frontend/src/features/attendance/attendance-state.js`
- Create: `frontend/src/features/attendance/AttendancePage.jsx`
- Modify: `netlify/functions/_shared/attendance-domain.mts`
- Modify: `netlify/functions/attendance.mts`
- Create: `migrations/20260806_attendance_break_events.sql`
- Test: `scripts/attendance-pause-test.mjs`
- Test: `tests/e2e/portal.spec.mjs`

**Interfaces:**
- Actions: `clock-in`, `break-start`, `break-end`, `clock-out`.
- Phases: `idle`, `working`, `paused`, `completed`.
- `reduceAttendanceState(state, event)` returns phase, clock-in/out, active break, accumulated break minutes, and ordered events.

- [ ] **Step 1: Write failing state transition tests**

```js
const state1 = reduceAttendanceState({ phase: 'idle', events: [] }, event('clock-in', '08:00'))
assert.equal(state1.phase, 'working')
const state2 = reduceAttendanceState(state1, event('break-start', '12:00'))
assert.equal(state2.phase, 'paused')
const state3 = reduceAttendanceState(state2, event('break-end', '12:30'))
assert.equal(state3.phase, 'working')
assert.equal(state3.breakMinutes, 30)
const state4 = reduceAttendanceState(state3, event('clock-out', '16:00'))
assert.equal(state4.phase, 'completed')
assert.throws(() => reduceAttendanceState(state1, event('break-end', '09:00')), /BREAK_END_WITHOUT_BREAK/)
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/attendance-pause-test.mjs`

- [ ] **Step 3: Add reversible database migration**

The migration must drop and recreate only the `attendance_events_action_check` constraint:

```sql
BEGIN;
ALTER TABLE attendance_events DROP CONSTRAINT IF EXISTS attendance_events_action_check;
ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_action_check
  CHECK (action IN ('clock-in', 'break-start', 'break-end', 'clock-out'));
COMMIT;
```

Do not execute this migration against production during implementation. Test it only on the isolated Neon development branch.

- [ ] **Step 4: Extend server transition validation**

Reject invalid sequences server-side. `clock-out` while paused returns `409` with `BREAK_MUST_END_FIRST`. Preserve client timestamp, server timestamp, location status, and audit fields for all four actions. Request location only for `clock-in` and `clock-out`; pause actions carry no coordinates.

- [ ] **Step 5: Build the digital attendance page**

The page contains:

```jsx
<time className="digital-clock" dateTime={now.toISOString()}>{hhmmss}</time>
```

Show date, planned shift, work site, current state, large context-sensitive buttons, and today's event timeline. Button rules:

- `idle` → Arbeit beginnen
- `working` → Pause beginnen and Arbeit beenden
- `paused` → Pause beenden
- `completed` → no further action unless a new valid shift/session is available

Disable buttons during submission and prevent double taps.

- [ ] **Step 6: Verify unit and browser tests**

Run:

```bash
node scripts/attendance-pause-test.mjs
npx playwright test tests/e2e/portal.spec.mjs -g "digital attendance"
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/attendance netlify/functions migrations scripts/attendance-pause-test.mjs tests/e2e/portal.spec.mjs

git commit -m "feat: add digital attendance and pause tracking"
```

---

### Task 4: Easy Mobile Schedule Planning Inside Dienstplan

**Files:**
- Create: `frontend/src/features/schedule/schedule-model.js`
- Create: `frontend/src/features/schedule/ScheduleEditor.jsx`
- Create: `frontend/src/features/schedule/SchedulePage.jsx`
- Modify: `frontend/src/styles.css`
- Test: `scripts/schedule-mobile-model-test.mjs`
- Test: `tests/e2e/mobile-schedule.spec.mjs`

**Interfaces:**
- `createShiftDraft(input)` validates employee, date, start, end, pause, work site, and work area.
- `selectedRepeatDates(anchorDate, weekdayKeys)` returns exact dates.
- Editor steps: `day`, `assignment`, `review`.

- [ ] **Step 1: Write failing pure model tests**

```js
assert.deepEqual(selectedRepeatDates('2026-08-10', ['mon', 'wed', 'fri']), [
  '2026-08-10', '2026-08-12', '2026-08-14',
])
assert.throws(() => createShiftDraft({ start: '16:00', end: '08:00' }), /INVALID_SHIFT_TIME/)
```

- [ ] **Step 2: Write failing mobile E2E flow**

```js
test('admin creates a shift on phone without horizontal scrolling', async ({ page }) => {
  await loginAsAdmin(page)
  await page.getByRole('button', { name: 'Dienstplan', exact: true }).click()
  await page.getByRole('button', { name: 'Schicht hinzufügen' }).click()
  await page.getByLabel('Tag').fill('2026-08-10')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByLabel('Mitarbeiter').selectOption('employee-anna')
  await page.getByLabel('Einsatzort').selectOption('site-nord')
  await page.getByLabel('Beginn').fill('08:00')
  await page.getByLabel('Ende').fill('16:00')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Entwurf speichern' }).click()
  await expect(page.getByText('Entwurf gespeichert')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBeFalsy()
})
```

- [ ] **Step 3: Implement responsive schedule views**

Desktop: weekly grid/list with edit buttons.

Mobile: day cards as primary view. `Schicht hinzufügen` opens an inline editor within the Dienstplan page, not a portal-wide modal. The editor has three short steps and a persistent back/next footer. Existing colors remain black/gold.

- [ ] **Step 4: Implement repeat and conflict presentation**

Use weekday chips rather than comma-separated prompt input. Show server warnings before publish. Exact duplicates remain blocked. Draft and publish are separate actions.

- [ ] **Step 5: Run focused tests**

```bash
node scripts/schedule-mobile-model-test.mjs
npx playwright test tests/e2e/mobile-schedule.spec.mjs --project=iphone-chromium
npx playwright test tests/e2e/mobile-schedule.spec.mjs --project=android-chromium
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/schedule frontend/src/styles.css scripts/schedule-mobile-model-test.mjs tests/e2e/mobile-schedule.spec.mjs

git commit -m "feat: simplify mobile shift planning"
```

---

### Task 5: Distribute Employees, Work Sites, Corrections, and Times Into Normal Pages

**Files:**
- Create: `frontend/src/features/employees/EmployeesPage.jsx`
- Create: `frontend/src/features/worksites/WorksitesPage.jsx`
- Create: `frontend/src/features/corrections/CorrectionsPage.jsx`
- Create: `frontend/src/features/overview/OverviewPage.jsx`
- Modify: `frontend/src/App.jsx`
- Test: `tests/e2e/portal.spec.mjs`

**Interfaces:**
- Employees consumes `/api/registrations`.
- Work sites consumes `/api/worksite-v2`.
- Corrections consumes `/api/attendance-maintenance?resource=corrections`.
- Overview consumes lightweight counts and today's data only.

- [ ] **Step 1: Write failing page-isolation tests**

```js
test('each function is on its own portal page', async ({ page }) => {
  await loginAsAdmin(page)
  await page.getByRole('button', { name: 'Mitarbeiter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mitarbeiter', exact: true })).toBeVisible()
  await expect(page.getByText('Standortprüfung')).toHaveCount(0)
  await page.getByRole('button', { name: 'Einsatzorte', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Einsatzorte', exact: true })).toBeVisible()
})
```

- [ ] **Step 2: Implement focused pages**

Each page owns only its feature. Do not place work-site editing inside Dienstplan. Do not place corrections inside Zeiterfassung for management users. Employees see only their own correction request action on Attendance/Times.

- [ ] **Step 3: Remove visible employee IDs**

Tables and forms show full names and email where permitted. Internal `userId` values remain in option values and API payloads only.

- [ ] **Step 4: Verify role boundaries and page isolation**

Run: `npx playwright test tests/e2e/portal.spec.mjs`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features frontend/src/App.jsx tests/e2e/portal.spec.mjs

git commit -m "feat: distribute portal functions into dedicated pages"
```

---

### Task 6: Reliable Company Settings Storage

**Files:**
- Create: `netlify/functions/_shared/company-settings.mts`
- Replace: `netlify/functions/settings.mts`
- Create: `frontend/src/features/settings/SettingsPage.jsx`
- Test: `scripts/company-settings-test.mjs`
- Test: `tests/e2e/settings-and-pdf.spec.mjs`

**Interfaces:**

```ts
type CompanySettings = {
  companyName: string
  phone: string
  email: string
  logoDataUrl: string | null
  updatedAt: string | null
  updatedBy: string | null
}
```

- `GET /api/settings` — authenticated management read.
- `PUT /api/settings` — admin/owner only, same-origin protected.

- [ ] **Step 1: Write failing validation and permission tests**

```js
assert.equal(validateCompanySettings({
  companyName: 'Habun Security',
  phone: '+49 511 123456',
  email: 'info@example.de',
  logoDataUrl: null,
}).email, 'info@example.de')
assert.throws(() => validateCompanySettings({ companyName: '', phone: '', email: 'x' }), /INVALID_COMPANY_SETTINGS/)
```

- [ ] **Step 2: Implement shared storage helper**

Use a strong-consistency Netlify Blob store named `portal-company-settings` and key `current`. Default to the existing `Habun Security` and `/habun-logo.png` when no saved record exists.

- [ ] **Step 3: Replace the proxy settings function**

The current proxy-only function is removed. Return clear German `401`, `403`, `400`, and `500` messages. Accept PNG/JPEG data URLs only, maximum decoded size 1 MiB.

- [ ] **Step 4: Build the Settings page**

Load existing values on entry, show a logo preview, save once, then reload from server and confirm persistence. Keep form input after temporary failure. Only admins/owners can submit.

- [ ] **Step 5: Run tests**

```bash
node scripts/company-settings-test.mjs
npx playwright test tests/e2e/settings-and-pdf.spec.mjs -g "settings"
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/company-settings.mts netlify/functions/settings.mts frontend/src/features/settings scripts/company-settings-test.mjs tests/e2e/settings-and-pdf.spec.mjs

git commit -m "feat: persist company settings reliably"
```

---

### Task 7: Branded PDF Preview and Download

**Files:**
- Modify: `netlify/functions/reports-v2.mts`
- Create: `frontend/src/features/reports/ReportsPage.jsx`
- Create: `scripts/pdf-branding-test.mjs`
- Test: `tests/e2e/settings-and-pdf.spec.mjs`

**Interfaces:**
- Reports page fetches one PDF blob, creates an object URL for preview, and reuses the same blob for download.
- PDF header consumes `CompanySettings` from Task 6.

- [ ] **Step 1: Write failing branding test**

Export a pure helper from `reports-v2.mts`:

```ts
export function companyHeaderLines(settings: CompanySettings) {
  return [settings.companyName, settings.phone, settings.email].filter(Boolean)
}
```

Test:

```js
assert.deepEqual(companyHeaderLines({
  companyName: 'Habun Security', phone: '0511 123456', email: 'info@habun.de', logoDataUrl: null,
}), ['Habun Security', '0511 123456', 'info@habun.de'])
```

- [ ] **Step 2: Read company settings inside the report function**

Replace environment-only header values. Embed the saved data-URL logo when present; otherwise embed `/habun-logo.png`. Draw company name, phone, and email separately so they remain readable.

- [ ] **Step 3: Implement preview before download**

After selecting employees and period, `Vorschau erstellen` fetches `/api/reports-v2` and displays:

```jsx
<object data={previewUrl} type="application/pdf" aria-label="PDF-Vorschau" />
```

`PDF herunterladen` downloads the already generated blob. Revoke old object URLs when selection changes or the component unmounts.

- [ ] **Step 4: Test PDF response and preview**

```js
test('saved company details appear in generated PDF flow', async ({ page }) => {
  await loginAsAdmin(page)
  await saveCompanySettings(page)
  await page.getByRole('button', { name: 'Berichte', exact: true }).click()
  await page.getByRole('button', { name: 'Vorschau erstellen' }).click()
  await expect(page.getByLabel('PDF-Vorschau')).toBeVisible()
  await expect(page.getByRole('button', { name: 'PDF herunterladen' })).toBeEnabled()
})
```

- [ ] **Step 5: Run tests**

```bash
node scripts/pdf-branding-test.mjs
npx playwright test tests/e2e/settings-and-pdf.spec.mjs
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/reports-v2.mts frontend/src/features/reports scripts/pdf-branding-test.mjs tests/e2e/settings-and-pdf.spec.mjs

git commit -m "feat: add branded PDF preview and download"
```

---

### Task 8: Responsive Black-Gold UI and Accessibility Pass

**Files:**
- Replace: `frontend/src/styles.css`
- Modify: all feature components as required for labels and landmarks
- Modify: `playwright.config.mjs`
- Test: `tests/e2e/responsive-layout.spec.mjs`

**Interfaces:**
- CSS custom properties retain existing values for background, gold, text, borders, success, warning, and danger.
- Breakpoints: mobile `max-width: 767px`; desktop `min-width: 768px`.

- [ ] **Step 1: Write failing responsive tests**

```js
for (const route of ['overview', 'attendance', 'schedule', 'reports', 'settings']) {
  test(`${route} has no page overflow`, async ({ page }) => {
    await openAdminRoute(page, route)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy()
  })
}
```

- [ ] **Step 2: Implement mobile layout rules**

Use a compact header, fixed-width-safe cards, `min-width: 0`, responsive grids, and action buttons at least 44 px high. Tables may use an internal `.table-scroll` container, but the page itself must not scroll horizontally.

- [ ] **Step 3: Preserve exact brand colors and logo geometry**

Create a test that reads the CSS tokens and compares them with the approved current token values. Do not crop, recolor, distort, or animate the logo.

- [ ] **Step 4: Run all viewport tests**

```bash
npx playwright test tests/e2e/responsive-layout.spec.mjs --project=desktop-chromium
npx playwright test tests/e2e/responsive-layout.spec.mjs --project=iphone-chromium
npx playwright test tests/e2e/responsive-layout.spec.mjs --project=android-chromium
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles.css frontend/src tests/e2e/responsive-layout.spec.mjs playwright.config.mjs

git commit -m "style: modernize responsive portal without changing brand colors"
```

---

### Task 9: Remove Legacy Duplicate UI and Complete Verification

**Files:**
- Delete after replacement verification: `public/attendance-v2.js`
- Delete after replacement verification: `public/attendance-v2-compat.js`
- Delete after replacement verification: `public/schedule-v2.js`
- Delete after replacement verification: `public/schedule-assist-v2.js`
- Delete after replacement verification: `public/live-attendance.js`
- Delete after replacement verification: `public/reports-v2.js`
- Delete after replacement verification: `public/worksite-v2.js`
- Delete after replacement verification: `public/attendance-corrections.js`
- Modify: `scripts/attendance-v2-verify.mjs`
- Modify: `package.json`
- Create: `docs/verification/unified-portal-report.md`
- Test: all Node and Playwright suites

**Interfaces:**
- `npm run verify` must build the source-controlled frontend and execute all legacy-compatible server/domain tests plus unified UI tests.

- [ ] **Step 1: Add a failing duplicate-UI scan**

```js
const files = await Promise.all([
  readFile('public/index.html', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])
const joined = files.join('\n')
assert.doesNotMatch(joined, /Neue Zeiterfassung|habun-v2-shell|Zeiterfassung und Planung/)
```

- [ ] **Step 2: Delete only unreferenced legacy UI modules**

Before deletion, use repository search and build output inspection to confirm no source, test, or HTML file imports them. Keep shared domain/server modules that the unified application still uses.

- [ ] **Step 3: Run full verification**

```bash
npm install --no-audit --no-fund
npm run verify
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Expected:

- all Node suites pass
- all Playwright tests pass on desktop, iPhone, and Android profiles
- no console errors or unexpected 4xx/5xx responses in mocked flows
- no duplicate portal/dialog/launcher
- Settings loads, saves, and reloads
- PDF preview and download work with logo, company name, phone, and email
- registration, approval, rejection, role access, attendance, pause, schedule draft/publish, corrections, and reports pass

- [ ] **Step 4: Perform isolated database verification**

Apply `migrations/20260806_attendance_break_events.sql` only to the isolated Neon development branch. Run clock-in → break-start → break-end → clock-out and verify stored order and calculated break duration. Do not touch the production branch.

- [ ] **Step 5: Write verification report**

Record exact commit SHA, test commands, pass counts, viewport coverage, schema comparison, known limitations, and confirmation that no deployment occurred.

- [ ] **Step 6: Open a draft pull request**

Open a draft PR from `fix/unified-portal-mobile-settings` to `main` with `Do not merge or deploy without explicit user approval` in the body.

- [ ] **Step 7: Stop before release**

Do not mark ready, merge, alter production environment variables, migrate the production database, or trigger a production deployment. Present the protected preview/test evidence to the user first.
