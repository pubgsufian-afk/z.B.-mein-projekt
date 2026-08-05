# Attendance V2 Requirement Traceability

Source of truth: approved `2026-08-05-pwa-zeiterfassung-standort-design.md`, the three approved visual references, the complete Work chat progress message, current `main` code, and the Neon `attendance-v2-dev` schema branch.

Status meanings:
- `saved`: verifiable in GitHub, Library, or Neon.
- `claimed-unsaved`: Work reported progress, but no durable source file was found.
- `partial`: older portal behaviour exists but does not meet the approved V2 requirement.
- `open`: no complete implementation found.

## Brand, privacy, and release

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-001 | Existing original logo remains unchanged | partial | File/hash and visual comparison before release |
| ATT-002 | Existing black background and colors remain unchanged | partial | CSS token and screenshot comparison |
| ATT-003 | No public employee, work-site, or shift data | partial | Public endpoint and page checks |
| ATT-004 | No deployment or merge before all tests and user approval | saved | Branch-only workflow and final release gate |
| ATT-005 | Installable PWA on iPhone and Android | partial | Manifest/install acceptance tests |
| ATT-006 | Location captured only on explicit clock-in/out | open | Client event and browser-permission tests |
| ATT-007 | No background tracking or movement history | open | API/data inspection and UI wording checks |
| ATT-008 | Role checks enforced server-side | partial | Endpoint authorization matrix |
| ATT-009 | Exact location retained six months | schema saved | Retention test and maintenance dry run |
| ATT-010 | Attendance/business data retained 24 months | schema saved | Retention test and maintenance dry run |

## Employee attendance

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-011 | Employee sees only own schedule and attendance | partial | Employee cross-user request denial |
| ATT-012 | Employee can clock in | partial | Inside/outside/unavailable/offline tests |
| ATT-013 | Employee can clock out | open | Inside/outside/unavailable/offline tests |
| ATT-014 | Employee cannot clock out before clock in | claimed-unsaved | Domain transition test |
| ATT-015 | Employee cannot create duplicate actions | claimed-unsaved | Client and server idempotency tests |
| ATT-016 | Stable client event ID created before submission | claimed-unsaved | Client ID test |
| ATT-017 | Device time and server receive time both stored | schema saved | API contract test |
| ATT-018 | State restored before buttons become active | claimed-unsaved | Restart recovery test |
| ATT-019 | Expired login during stamping does not lose booking | claimed-unsaved | Session-expiry retry test |
| ATT-020 | Clear confirmation includes time and status | open | UI state test |
| ATT-021 | Planned shift shown | partial | Employee UI test |
| ATT-022 | Planned work site shown | partial | Employee UI test |
| ATT-023 | Configured break minutes shown read-only | open | Employee UI test |
| ATT-024 | Actual start/end and net time shown after completion | open | Employee UI test |
| ATT-025 | Correction request available after completion | open | Correction workflow test |
| ATT-026 | Employee has web view for day/month/custom period | open | History filter test |
| ATT-027 | Employee cannot download PDF | partial | UI removal and direct endpoint denial |
| ATT-028 | Employee pause-start/pause-end controls are removed | open | Baseline scan and UI test |

## Location and offline behaviour

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-029 | Work site has coordinates and configurable radius | schema saved | Admin API and DB test |
| ATT-030 | Default radius is 500 metres | schema saved | Domain/API test |
| ATT-031 | Inside radius is green/inside | schema saved | Distance classification test |
| ATT-032 | Outside radius is red but booking allowed | schema saved | API/UI test |
| ATT-033 | Unavailable/refused location is red but booking allowed | schema saved | API/UI test |
| ATT-034 | Accuracy and distance are stored | schema saved | API/DB test |
| ATT-035 | Planned work site linked to event | schema saved | API/DB test |
| ATT-036 | Offline booking stored locally | claimed-unsaved | Queue test |
| ATT-037 | Offline events replay in original order | claimed-unsaved | Queue sorting test |
| ATT-038 | Duplicate replay prevented | schema saved | Idempotency API test |
| ATT-039 | Offline marker visible to management | open | Live view test |
| ATT-040 | Capture and upload times visible to management | open | Detail view test |
| ATT-041 | Sync conflicts are flagged, not silently overwritten | schema saved | Conflict API test |

## Admin and manager live view

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-042 | Live attendance page for admin and manager | open | Management page test |
| ATT-043 | Today's employees and status visible | open | Live API/UI test |
| ATT-044 | Actual start and work site visible | open | Live API/UI test |
| ATT-045 | Distance and red/green state visible | open | Live API/UI test |
| ATT-046 | Filters by date/site/employee/status | open | Filter test |
| ATT-047 | Map shows only stored clock snapshots | open | Map-link/data test |
| ATT-048 | Detail includes schedule, break, times, accuracy, warnings | open | Detail test |
| ATT-049 | Manager cannot manage accounts or global settings | partial | Role matrix test |
| ATT-050 | Only admin manages work-site coordinates | open | Role matrix test |

## Schedule V2

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-051 | Weekly calendar by days/sites/employees | partial | Schedule V2 UI test |
| ATT-052 | Create/edit shift with only required fields | partial | Form test |
| ATT-053 | Break quick values 30/45/60 and custom | open | Schedule test |
| ATT-054 | Net duration preview | open | Schedule test |
| ATT-055 | Employee cannot change break | open | Role/UI test |
| ATT-056 | Copy previous week | open | Schedule test |
| ATT-057 | Use shift templates | open | Schedule test |
| ATT-058 | Repeat selected weekdays | open | Schedule test |
| ATT-059 | Move/reassign shifts | partial | Schedule test |
| ATT-060 | Suggest suitable available employees | open | Availability test |
| ATT-061 | Warn about overlaps before save | partial | Conflict test |
| ATT-062 | Exact duplicate is blocked | saved | Existing and V2 regression test |
| ATT-063 | New plan saved as draft | open | Visibility test |
| ATT-064 | Draft review summarizes conflicts | open | Review test |
| ATT-065 | Only admin/manager publishes plan | open | Authorization test |
| ATT-066 | Published changes create new version/audit | open | Version test |

## Corrections and audit

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-067 | Employee submits reasoned correction request | schema saved | API/UI test |
| ATT-068 | Admin/manager approve or reject | schema saved | Decision test |
| ATT-069 | Clarification/request state supported | open | Workflow test |
| ATT-070 | Original values remain immutable | schema saved | DB/effective-value test |
| ATT-071 | Before/requested/after values retained | schema saved | Audit test |
| ATT-072 | Actor and all timestamps retained | schema saved | Audit test |
| ATT-073 | Employee cannot edit location values | schema saved | Authorization/validation test |
| ATT-074 | Wrong location can be commented/marked reviewed | open | Workflow test |
| ATT-075 | Legal hold pauses deletion only for affected records | schema saved | Retention test |

## Reports

| ID | Requirement | Current status | Planned verification |
|---|---|---|---|
| ATT-076 | Reports available only to admin/manager | partial | Server authorization test |
| ATT-077 | Employee detail report | partial | V2 content test |
| ATT-078 | Combined overview report | partial | V2 content test |
| ATT-079 | One day, full month, arbitrary range | open | Period test |
| ATT-080 | One/multiple/all employees | partial | Selection test |
| ATT-081 | Combined or explicit separate PDFs | open | Output-mode test |
| ATT-082 | One employee-month stays one PDF, multi-page if needed | open | Pagination test |
| ATT-083 | Multi-month subtotals and grand total | open | Totals test |
| ATT-084 | Planned and actual times side by side | open | Content test |
| ATT-085 | Automatic break and daily net hours | open | Calculation test |
| ATT-086 | Only employee name as employee personal data | open | PDF text scan |
| ATT-087 | No personal number/private address/birth/tax data | open | PDF text scan |
| ATT-088 | No signature fields | open | Source and PDF text scan |
| ATT-089 | Original logo and approved company contact data | partial | Asset/hash and PDF inspection |
| ATT-090 | No-data range shows message and does not create misleading PDF | open | API/UI test |

## Work-chat progress reconciliation

The Work chat reported database completion and a partially completed employee attendance task. The Neon schema is durable and verified. The employee client/offline source code and final fixes for session expiry and restore-before-enable were not found in GitHub or Library, so they remain `claimed-unsaved` and must be implemented and tested again rather than trusted as complete.
