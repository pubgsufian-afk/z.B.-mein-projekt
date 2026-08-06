# Automatische Gesamtprüfung

Ergebnis: fehlgeschlagen

- Quell- und API-Prüfung: 0
- Produktions-Build: 0
- Browserprüfung Desktop/iPhone/Android: 1
- Hauptseite wurde nicht veröffentlicht oder verändert.

## Letzte Prüfausgabe
```text

> habun-mitarbeiterportal-main-repair@2026.8.6 verify
> npm run verify:all


> habun-mitarbeiterportal-main-repair@2026.8.6 verify:all
> npm run verify:legacy && npm run verify:v2 && npm run verify:unified && npm run verify:database


> habun-mitarbeiterportal-main-repair@2026.8.6 verify:legacy
> node scripts/admin-time-test.mjs && node scripts/schedule-multi-test.mjs

Admin-Stundenzettel-Test erfolgreich
Dienstplan-Mehrfachstellen geprüft · 5 Regeln erfolgreich

> habun-mitarbeiterportal-main-repair@2026.8.6 verify:v2
> node scripts/attendance-v2-verify.mjs

Attendance domain tests passed · 17 assertions
Attendance API contract tests passed · 25 assertions
Attendance handler tests passed · 16 assertions
Attendance repository tests passed · 13 assertions
Schedule V2 tests passed · 6 assertions
Schedule assistant tests passed · 8 assertions
Worksite V2 tests passed · 6 assertions
Attendance correction tests passed · 9 assertions
Attendance retention tests passed · 6 assertions
Reports V2 tests passed · 17 assertions
Unified attendance verification passed · 1 React application · 8 functions · 10 compatibility suites

> habun-mitarbeiterportal-main-repair@2026.8.6 verify:unified
> node scripts/apply-portal-audit-fixes.mjs && node scripts/apply-scheduler-support.mjs && node scripts/fix-scheduler-patch-regressions.mjs && node scripts/unified-portal-test.mjs && node scripts/employee-access-policy-test.mjs && node scripts/scheduler-support-test.mjs && node scripts/attendance-pause-test.mjs && node scripts/company-settings-test.mjs && node scripts/pdf-branding-test.mjs && node scripts/report-download-contract-test.mjs && node scripts/schedule-pdf-test.mjs && node scripts/employee-schedule-compact-test.mjs && node scripts/portal-audit-regression-test.mjs && node scripts/report-production-v2-test.mjs

Applied portal audit fixes: frontend/src/App.jsx, netlify/functions/unified-reports.mts, netlify/functions/schedule-v2.mts
Scheduler support applied: frontend/src/App.jsx, netlify/functions/_shared/portal-role.mts, netlify/functions/session.mts, netlify/functions/schedule-v2.mts, netlify/functions/schedule-assist-v2.mts, tests/e2e/unified-portal.spec.mjs
Scheduler patch regressions fixed
Unified portal source tests passed
Employee kiosk access policy tests passed
Scheduler support policy tests passed
Attendance pause tests passed
Company settings tests passed
PDF, Excel and report query tests passed
Report download contract tests passed
Schedule PDF tests passed
Compact employee schedule tests passed
Portal audit regression tests passed
Production report database, redirects, warnings, mobile filter and centered PDF logo tests passed

> habun-mitarbeiterportal-main-repair@2026.8.6 verify:database
> node scripts/netlify-database-config-test.mjs

Netlify database configuration test passed

> habun-mitarbeiterportal-main-repair@2026.8.6 build
> node scripts/run-full-preview-audit.mjs

AUDIT admin-time: OK
Admin-Stundenzettel-Test erfolgreich
AUDIT schedule-multi: OK
Dienstplan-Mehrfachstellen geprüft · 5 Regeln erfolgreich
AUDIT attendance-v2: OK
Attendance domain tests passed · 17 assertions
Attendance API contract tests passed · 25 assertions
Attendance handler tests passed · 16 assertions
Attendance repository tests passed · 13 assertions
Schedule V2 tests passed · 6 assertions
Schedule assistant tests passed · 8 assertions
Worksite V2 tests passed · 6 assertions
Attendance correction tests passed · 9 assertions
Attendance retention tests passed · 6 assertions
Reports V2 tests passed · 17 assertions
Unified attendance verification passed · 1 React application · 8 functions · 10 compatibility suites
AUDIT portal-fixes: OK
Portal audit fixes already applied
AUDIT support-patch: OK
Scheduler support applied: tests/e2e/unified-portal.spec.mjs
AUDIT support-regressions: OK
Scheduler patch regressions fixed
AUDIT unified-portal: OK
Unified portal source tests passed
AUDIT employee-policy: OK
Employee kiosk access policy tests passed
AUDIT support-policy: OK
Scheduler support policy tests passed
AUDIT attendance-pause: OK
Attendance pause tests passed
AUDIT company-settings: OK
Company settings tests passed
AUDIT pdf-branding: OK
PDF, Excel and report query tests passed
AUDIT report-download: OK
Report download contract tests passed
AUDIT schedule-pdf: OK
Schedule PDF tests passed
AUDIT employee-schedule: OK
Compact employee schedule tests passed
AUDIT portal-regression: OK
Portal audit regression tests passed
AUDIT report-production: OK
Production report database, redirects, warnings, mobile filter and centered PDF logo tests passed
AUDIT database-config: OK
Netlify database configuration test passed
AUDIT frontend-build: OK
public/assets/habun-portal.js   258.0kb
  public/assets/habun-portal.css   28.7kb

⚡ Done in 42ms
AUDIT dist-build: OK
AUDIT browser: OK

> habun-mitarbeiterportal-main-repair@2026.8.6 test:e2e
> node scripts/prepare-unified-e2e.mjs && node scripts/split-browser-audit-tests.mjs && playwright test tests/e2e/unified-portal.spec.mjs

file:///home/runner/work/z.B.-mein-projekt/z.B.-mein-projekt/scripts/prepare-unified-e2e.mjs:10
  if (count !== 1) throw new Error(`${label}: erwartet 1 Treffer, gefunden ${count}`)
                         ^

Error: mobile navigation helper: erwartet 1 Treffer, gefunden 0
    at replaceOnce (file:///home/runner/work/z.B.-mein-projekt/z.B.-mein-projekt/scripts/prepare-unified-e2e.mjs:10:26)
    at file:///home/runner/work/z.B.-mein-projekt/z.B.-mein-projekt/scripts/prepare-unified-e2e.mjs:14:1

Node.js v22.23.1
```
