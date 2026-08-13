# Stundenzettel PDF/Excel Logo Parity Implementation Plan

**Goal:** PDF and Excel use the same Stundenzettel structure and the clean transparent Habun logo.

**Architecture:** Extend the existing monthly export patch. Keep PDF structure, replace the old rectangular logo source for exports, and make Excel mirror the PDF in A4 portrait.

**Tech Stack:** Netlify Functions, TypeScript, pdf-lib, exceljs, GitHub Actions.

## Global Constraints
PDF structure stays the same except for logo rendering. Excel mirrors the PDF. Time data and calculations do not change.

### Task 1
Write a failing source contract in `scripts/timesheet-monthly-excel-style-source-test.mjs` for clean logo resolution and PDF/Excel parity, then run it and confirm failure.

### Task 2
Modify `scripts/apply-professional-timesheet-excel.mjs` to map `/habun-logo.png` to `/habun-logo-pdf.png` for exports and render the clean PDF logo.

### Task 3
Change Excel to A4 portrait with the same title, period, employee, seven columns, blank dates, total, notes, logo and footer as the PDF. Run the focused source contract and confirm it passes.

### Task 4
Run the full verification workflow, production build and E2E tests. Merge only after all checks pass.
