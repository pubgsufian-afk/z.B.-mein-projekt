# Habun Full Admin Portal Relay

Date: 2026-08-24

## Goal

Give the ChatGPT-operated Habun relay complete administrative control over the normal business and administration functions of the Habun employee portal while keeping each user request as compact and low-cost as possible.

The relay should be able to perform the same normal administrative work that can be performed through the portal UI, plus safe bulk operations that are useful for administration but would be inefficient to perform screen by screen.

The relay is not an unrestricted infrastructure shell. It does not expose passwords, authentication secrets, environment secrets, raw database credentials, arbitrary SQL, or a way to bypass legal holds or owner-account safety protections.

## Core principle

One encrypted control path for the whole portal:

ChatGPT -> encrypted envelope -> PR #73 -> GitHub Actions OIDC -> Netlify admin router -> domain handler -> production data/service -> encrypted result artifact.

PR #73 stays open and is not merged. The existing encryption and OIDC trust model is retained.

The normal path does not use browser-by-browser entry and does not deploy application code for ordinary administrative changes.

## Scope

The full-admin relay covers every current admin-visible business domain in the portal and is extensible to future admin-visible domains through an explicit capability registry.

### Employees and registrations

The relay can:

- list/search employees and registrations
- inspect one employee account/profile
- edit normal profile data such as full name, company, worksite/location and other existing internal profile fields
- manage the normal role/status settings that the portal owner is allowed to manage
- activate/deactivate accounts where current owner rules permit it
- reconcile a provisional/guest identity with a registered portal identity
- propagate canonical employee identity changes to dependent schedule/reporting sources
- inspect and correct duplicate or stale employee-directory entries when there is an unambiguous canonical target

Existing protection of the owner account remains authoritative. The relay does not silently downgrade, deactivate or delete the protected owner account.

### Schedule / Dienstplan

The relay can:

- list shifts for any requested practical historical/future range
- get a single shift
- create/publish one or many shifts
- edit employee assignment, date, start, end, pause, work area, location, note and publish state where supported
- bulk-update multiple shifts
- delete mistaken shifts
- detect exact duplicates, time duplicates and overlaps
- rebind historical guest/provisional shifts to a registered employee
- verify the effective production schedule after every mutation

### Timesheets / attendance / Stundenzettel

The relay can:

- list attendance/timesheet data for any requested practical range
- inspect resolved work sessions
- create an administrative time entry where the existing business rules support it
- correct clock-in and clock-out times
- correct pause minutes
- correct/rebind employee identity when historical records belong to a newly registered employee
- delete selected mistaken attendance events when legally allowed
- detect duplicates and inconsistent sessions
- bulk-update multiple sessions
- keep the existing audit trail and retention behavior

Legal holds and retention protections are never bypassed silently.

### Worksites / objects / Einsatzorte

The relay can perform the normal administrative operations supported by the portal for worksites/objects, including:

- list/get worksites
- create/update normal worksite settings
- update configured location/geofence data where the portal owner is allowed to do so
- deactivate/remove a worksite only through the same business constraints used by the portal
- verify references from employee and schedule records before destructive changes

### Company settings

The relay can manage normal company-level settings that are already editable by the portal owner, including company/profile configuration and company logo operations where supported.

Secrets, environment variables and authentication credentials are excluded.

### Reports, PDFs and daily reports

The relay can:

- retrieve report data using targeted filters
- generate/export the existing report/PDF types available to admins
- request daily, employee, schedule and monthly reporting views supported by the portal
- avoid regenerating identical reports repeatedly during the same task

Read-only report generation should not require a code deploy.

### Other current and future admin-visible portal functions

A capability registry defines which portal domains/actions the encrypted admin router can use.

When a new normal admin function is added to the portal, support is added by registering a typed domain handler rather than creating a second control path or reverting to browser automation.

## Permission model

The relay operates as a dedicated internal full-admin actor with owner-equivalent business-data privileges for supported actions.

It may have bulk capabilities that are more efficient than the UI, but it does not get permission to:

- expose or reset secrets through the relay
- bypass owner-account self-protection
- bypass legal holds or mandatory audit/retention rules
- execute arbitrary SQL or arbitrary server code
- alter GitHub/Netlify infrastructure as part of a normal portal-data request

Destructive actions are performed only when the user's request clearly asks for them. Ambiguous destructive requests are rejected or require clarification.

## Command architecture

Keep the existing encrypted envelope and OIDC transport. Generalize the decrypted command payload into a portal-admin command.

Recommended command shape:

- `version`
- `commandId`
- `createdAt`
- `action`
- `domain`
- typed filters or target identifiers
- optional `operations[]` for bulk work
- optional `reason`
- `responseKey`

For multi-domain administrative work, support a compact `portal-batch` command with bounded operations. Examples:

- profile update + directory sync
- employee rebind across schedule + attendance
- many pause corrections for one employee/month
- several independent shift corrections

Each operation returns an encrypted per-item status and the command returns aggregate counts.

## Domain router

The OIDC endpoint should route an already authenticated/decrypted command to a small domain adapter rather than duplicating business rules.

Adapters should call the same underlying service/repository functions used by the production portal wherever practical.

Initial adapters:

- employees / registrations
- schedule
- attendance
- worksites
- company settings
- reports / exports

The router owns protocol validation, authorization, batching, privacy-safe result handling and common audit metadata. Domain handlers own business validation and data consistency.

## Identity model

Registered portal user IDs are canonical.

Automatic reconciliation is allowed only when the match is unique and provable. Exact normalized-name reconciliation can be automatic when there is one provisional identity and one registered identity.

For changed/expanded names, support an explicit scoped rebind operation with:

- source provisional identity or old canonical name
- target registered user ID/name
- date range when relevant
- domains: schedule, attendance, directory or selected combination

An explicit rebind must never guess among multiple registered accounts.

## Range handling

From the user's perspective, any practical requested range is one task.

Internally, range-limited endpoints may be chunked, but the planner must use the fewest chunks required by endpoint limits. Chunking is transparent and produces one combined encrypted result and one final summary.

Filters are pushed down as far as possible. If the user asks for one employee between two dates, do not load every employee and the entire portal history.

## Cost-control / Guthaben rules

Cost efficiency is a first-class requirement, not an optional optimization.

For normal mutation tasks, target this flow:

1. One targeted read containing only the employee/object/domain/range needed.
2. Compute the minimal diff locally from that result.
3. One encrypted batch mutation containing all independent required changes that safely fit in one command.
4. One targeted verification read.

Rules:

- no per-day loop when a range query can answer the request
- no per-employee loop when a filtered bulk query can answer the request
- no browser automation as the default path
- no Netlify deploy for ordinary data operations
- no full directory sync when a targeted identity lookup/rebind is enough
- cache/reuse directory and capability metadata inside one user task when it is still valid
- combine independent changes into one command up to a safe bounded batch size
- if batching must be split, use the minimum number of batches
- return compact results by default; only fetch detailed rows that are needed to decide or verify a change
- do not generate reports/PDFs repeatedly when one result can be reused

The practical target is usually: `1 read -> 1 batch -> 1 verification`.

## Read planning

Add a compact inspection action that can request multiple related domains in one encrypted read when this is cheaper than several calls.

Example: correcting a newly registered employee may request employee identity + schedule rows + attendance rows for the same date range in one inspection command.

The response should be projection-based: return only fields needed by the requested operation.

## Mutation planning

Before sending a batch, the client computes which rows actually differ.

No-op updates are omitted. Existing correct rows are not rewritten merely because they were read.

Bulk mutations should support per-operation idempotency through command IDs/item IDs so safe retries do not duplicate records.

## Transactions and consistency

Operations that must stay consistent across domains should be grouped transactionally where the same data store allows it, or implemented as an explicit coordinated workflow with before/after verification when they span stores.

Employee identity rebind is the primary cross-domain consistency case. A rebind should not leave schedule rows on one identity and attendance rows on another without reporting a failure.

For partial batch failure, detailed encrypted results must identify failed operations. The final user response must never claim complete success when only part succeeded.

## Audit

Every mutation includes:

- stable assistant actor identity
- command/request ID
- action/domain
- target identifier
- reason where manual correction requires one
- before/after values where the existing domain audit model requires them
- timestamp

The existing audit and retention policies remain authoritative.

## Privacy

GitHub comments contain only encrypted envelopes.

Workflow logs and commit statuses contain only privacy-safe aggregate information and run IDs.

Do not write employee names, schedules, attendance timestamps, report contents, response keys or decrypted detailed results to GitHub logs/statuses.

Detailed results stay encrypted in the short-retention workflow artifact and are decrypted only by the requesting client.

## Verification policy

Never claim a portal change succeeded merely because the command was submitted.

Before completion:

1. confirm relay/OIDC execution status
2. decrypt the detailed result
3. verify the target state through one targeted read
4. check the fields relevant to the request
5. for cross-domain operations, verify every affected domain

For example, a historical employee rebind must verify profile/directory identity and all requested schedule/attendance rows in the range.

## Failure behavior

- ambiguous identity: reject instead of guessing
- protected owner operation: reject
- legal hold: reject the protected mutation
- stale/missing target: report not-found/conflict
- partial batch: report exact failed item count and do not state full success
- transport/decryption failure: do not retry blindly with changed content; regenerate a fresh valid encrypted command

## Browser fallback

Browser interaction remains an explicit emergency fallback only when:

- the portal exposes a function that has not yet been registered in the full-admin relay, and
- the user explicitly accepts the fallback for that task.

The long-term fix for a missing capability is to add the typed domain action to the relay, not to make browser entry the normal workflow.

## Example: Kwame Akakpo historical correction

User request: correct Kwame Akakpo from 2026-08-01 through 2026-08-24 after the employee registered.

Expected optimized flow:

1. One targeted inspection returns the registered Kwame Akakpo identity plus old provisional schedule/attendance rows in the requested range.
2. Compute whether any row already has the canonical user ID.
3. Send one scoped employee-history rebind for only the rows that need correction.
4. Run one combined verification for the same employee/range/domains.

No per-day loop, no browser entry, no direct SQL and no deploy.

## Success criteria

The design is complete when ChatGPT can safely handle requests such as:

- “Change this employee's profile and worksite.”
- “Activate/deactivate this employee account.”
- “Correct all Dienstplan entries for this employee this month.”
- “Change pauses on these Stundenzettel.”
- “Correct clock-in/out for these days.”
- “Move old guest records to the new registered account.”
- “Create/update this worksite.”
- “Change this company setting.”
- “Generate the monthly report/PDF.”
- “Check everything for this employee and fix only what is wrong.”

using the encrypted PR #73 relay with the minimum practical number of calls, a complete audit trail, and a verified final state.