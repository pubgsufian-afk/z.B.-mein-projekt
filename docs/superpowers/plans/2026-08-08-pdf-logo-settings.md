# Zentrales PDF-Firmenlogo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Hauptadmin kann ein Firmenlogo in den Einstellungen hochladen, automatisch freistellen und zentral speichern; alle danach erzeugten PDFs verwenden dieses Logo mittig als dezentes Wasserzeichen.

**Architecture:** Die bestehenden Firmeneinstellungen bleiben die zentrale Konfiguration. Das verarbeitete PNG wird in Netlify Blobs gespeichert und über eine gemeinsame Branding-Hilfsfunktion an alle PDF-Generatoren geliefert. Die UI verarbeitet PNG/JPEG/WebP lokal zu einem transparenten PNG, die Server-API erzwingt Owner-only für Logoänderungen, während Admins weiterhin nur textuelle Firmendaten bearbeiten dürfen.

**Tech Stack:** React 19, Netlify Functions, Netlify Blobs, Netlify Identity, pdf-lib, Node.js Source-Tests, bestehende Playwright-E2E-Struktur.

## Global Constraints

- Nur `owner` (Chef / Hauptadmin) darf das PDF-Logo hochladen, ersetzen oder zurücksetzen.
- `admin` darf bestehende textuelle Firmendaten weiterhin bearbeiten, aber keine Logo-Daten verändern.
- Eingaben: PNG, JPEG/JPG und WebP; serverseitig gespeichert wird PNG.
- Das Logo wird auf jeder PDF-Seite proportional skaliert, zentriert und mit niedriger Deckkraft hinter Text/Tabellen gezeichnet.
- Fehlt ein benutzerdefiniertes Logo oder kann es nicht geladen werden, muss `/habun-logo.png` als Fallback funktionieren.
- Bestehende Dienstplan-, Stundenzettel-, Bericht-, Rollen- und Download-Funktionen dürfen nicht regressieren.

---

### Task 1: Zentrale Logo-Speicherung und Owner-only API

**Files:**
- Modify: `netlify/functions/_shared/company-settings.mts`
- Create: `netlify/functions/_shared/pdf-branding.mts`
- Modify: `netlify/functions/company-settings.mts`
- Test: `scripts/company-settings-test.mjs`
- Create: `scripts/pdf-logo-settings-test.mjs`

**Interfaces:**
- Produces: `readPdfLogoBytes(request: Request): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; source: 'custom' | 'default' } | null>`
- Produces: `saveCustomPdfLogo(dataUrl: string): Promise<{ logoUrl: string; logoVersion: string; logoUpdatedAt: string }>`
- Produces: `resetCustomPdfLogo(): Promise<void>`
- `PUT /api/company-settings` accepts text settings for owner/admin; `pdfLogoDataUrl` and `resetPdfLogo` are owner-only mutations.

- [ ] **Step 1: Add failing source tests for role and logo contract**

```js
assert.match(companySettingsSource, /current\.role\s*!==\s*['"]owner['"]/)
assert.match(companySettingsSource, /pdfLogoDataUrl/)
assert.match(companySettingsSource, /resetPdfLogo/)
assert.match(brandingSource, /getStore\(/)
assert.match(brandingSource, /image\/png/)
assert.match(brandingSource, /habun-logo\.png/)
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `node scripts/company-settings-test.mjs && node scripts/pdf-logo-settings-test.mjs`
Expected: FAIL because the owner-only logo mutation and shared branding helper do not exist yet.

- [ ] **Step 3: Implement minimal central storage**

Use a dedicated Netlify Blob store (for example `portal-pdf-branding`) with a stable key for the current PNG. Extend `CompanySettings` with `logoVersion` and `logoUpdatedAt`, but keep `logoUrl` fallback-compatible. Validate the incoming `data:image/png;base64,...`, decoded size, PNG signature, and non-empty payload before replacing the stored logo. Reset removes the custom blob metadata and restores `/habun-logo.png`.

- [ ] **Step 4: Enforce authorization server-side**

`GET /api/company-settings` remains owner/admin. For `PUT`, split text fields from logo mutations. If `pdfLogoDataUrl` or `resetPdfLogo` is present and the actor is not `owner`, return 403 before any write. Text-only updates remain available to owner/admin.

- [ ] **Step 5: Re-run focused tests**

Run: `node scripts/company-settings-test.mjs && node scripts/pdf-logo-settings-test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/company-settings.mts netlify/functions/_shared/pdf-branding.mts netlify/functions/company-settings.mts scripts/company-settings-test.mjs scripts/pdf-logo-settings-test.mjs
git commit -m "feat: add owner-managed PDF logo storage"
```

### Task 2: Hauptadmin-Logooberfläche mit transparenter PNG-Aufbereitung

**Files:**
- Create: `frontend/src/pdf-logo-tools.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`
- Create: `scripts/pdf-logo-ui-test.mjs`

**Interfaces:**
- Consumes: `PUT /api/company-settings` logo contract from Task 1.
- Produces: `preparePdfLogo(file: File): Promise<string>` returning a PNG data URL.
- `SettingsPage({ session })` shows editable logo controls only for `session.role === 'owner'`.

- [ ] **Step 1: Add failing UI/source tests**

Test for `SettingsPage({ session })`, `accept="image/png,image/jpeg,image/webp"`, owner-only rendering, preview, replace/reset buttons, and import of `preparePdfLogo`.

- [ ] **Step 2: Run UI test and confirm failure**

Run: `node scripts/pdf-logo-ui-test.mjs`
Expected: FAIL because the logo uploader and image processor are absent.

- [ ] **Step 3: Implement `preparePdfLogo`**

Load the selected image into an offscreen canvas, downscale to a safe maximum dimension, retain existing alpha, derive candidate background color from corner/rim pixels, then flood-fill only edge-connected pixels within a conservative RGB tolerance to alpha 0. Export with `canvas.toDataURL('image/png')`. Reject unsupported/oversized/unreadable files with German error messages.

- [ ] **Step 4: Update settings UI**

Pass `session` into `SettingsPage`. Keep textual fields in the existing form. Remove the user-editable raw `Logo-Pfad` field. For owner only, add `Firmenlogo / PDF-Logo` with current preview, file picker, processed preview, `Logo speichern` and `Auf Standardlogo zurücksetzen`. Admin sees the current preview plus a short read-only note that only Hauptadmin may change it.

- [ ] **Step 5: Add focused styling**

Add responsive preview/upload styles that fit the existing panel system without changing global colors or navigation.

- [ ] **Step 6: Re-run UI test**

Run: `node scripts/pdf-logo-ui-test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pdf-logo-tools.js frontend/src/App.jsx frontend/src/styles.css scripts/pdf-logo-ui-test.mjs
git commit -m "feat: add Hauptadmin PDF logo controls"
```

### Task 3: Alle PDF-Generatoren auf zentrale Wasserzeichen-Nutzung umstellen

**Files:**
- Modify: `netlify/functions/schedule-pdf.mts`
- Modify: `netlify/functions/schedule-pdf-fixed.mts`
- Modify: `netlify/functions/timesheet-reports.mts`
- Modify: `netlify/functions/unified-reports.mts`
- Modify: `netlify/functions/unified-reports-fixed.mts`
- Modify: `scripts/pdf-branding-test.mjs`
- Modify: `scripts/final-export-logo-test.mjs`
- Create: `scripts/pdf-logo-coverage-test.mjs`

**Interfaces:**
- Consumes: `readPdfLogoBytes()` from Task 1.
- Each PDF generator embeds returned bytes with `pdf.embedPng` or `pdf.embedJpg` and calls a common centering helper or equivalent shared draw function.

- [ ] **Step 1: Add failing coverage tests**

Require every active/fallback PDF source to import the shared branding helper and reject direct hard-coded logo fetches. Verify centered coordinates are derived from page dimensions and image dimensions, and opacity stays in a low watermark range.

- [ ] **Step 2: Run PDF branding tests and confirm failure**

Run: `node scripts/pdf-branding-test.mjs && node scripts/final-export-logo-test.mjs && node scripts/pdf-logo-coverage-test.mjs`
Expected: FAIL because current generators fetch `settings.logoUrl` independently and some draw header logos instead of a centered watermark.

- [ ] **Step 3: Implement shared embedding/drawing**

Use the helper result in each generator. Draw the logo before table/text content. Scale proportionally to a bounded area appropriate to portrait/landscape page size; use centered `x = (pageWidth - drawnWidth) / 2`, `y = (pageHeight - drawnHeight) / 2`, and opacity about `0.06`. Keep company name/phone/email text headers where currently required, but do not use a second opaque logo in the header unless explicitly required by an existing contract.

- [ ] **Step 4: Re-run PDF tests**

Run: `node scripts/pdf-branding-test.mjs && node scripts/final-export-logo-test.mjs && node scripts/pdf-logo-coverage-test.mjs && node scripts/schedule-pdf-test.mjs && node scripts/timesheet-report-source-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/schedule-pdf.mts netlify/functions/schedule-pdf-fixed.mts netlify/functions/timesheet-reports.mts netlify/functions/unified-reports.mts netlify/functions/unified-reports-fixed.mts scripts/pdf-branding-test.mjs scripts/final-export-logo-test.mjs scripts/pdf-logo-coverage-test.mjs
git commit -m "feat: use central logo watermark on all PDFs"
```

### Task 4: Regression, build, PR and production verification

**Files:**
- Modify if needed: `tests/e2e/unified-portal.spec.mjs`
- No production data mutation beyond deployment.

**Interfaces:**
- Consumes all prior tasks.
- Produces a merge-ready branch with passing verification and a deployable build.

- [ ] **Step 1: Run focused feature suite**

Run: `node scripts/company-settings-test.mjs && node scripts/pdf-logo-settings-test.mjs && node scripts/pdf-logo-ui-test.mjs && node scripts/pdf-logo-coverage-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/final-export-logo-test.mjs`
Expected: PASS.

- [ ] **Step 2: Run unified verification**

Run: `npm run verify:unified`
Expected: PASS.

- [ ] **Step 3: Build production bundle**

Run: `npm run build`
Expected: exit 0 and a successfully generated production bundle.

- [ ] **Step 4: Review diff for scope/security**

Confirm no credentials, employee data, or raw uploaded logo bytes are committed to Git. Confirm only owner can mutate logo through server API and direct admin API attempts return 403.

- [ ] **Step 5: Open PR and verify checks**

Create a PR from `feat/pdf-logo-settings-20260808` to `main`, wait for required checks, review changed files, then merge only when green.

- [ ] **Step 6: Deploy and verify Netlify production**

Verify the production deploy reaches `ready`, all required functions are present, and the site remains the existing `habun-mitarbeiterportal` project. Confirm settings, Stundenzettel PDF, Dienstplan PDF, and Bericht PDF use the centralized branding path.

- [ ] **Step 7: Final production smoke check**

On the live portal, confirm: owner logo controls visible; admin controls read-only; existing company fields save; a newly created PDF has a centered transparent watermark; standard logo fallback works when custom logo is reset.
