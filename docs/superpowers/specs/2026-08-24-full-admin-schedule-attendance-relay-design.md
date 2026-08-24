# Full Admin Schedule & Attendance Relay

Date: 2026-08-24

## Goal

Give the ChatGPT-operated Habun relay complete administrative control over schedule and timesheet data while keeping each user request as cheap and compact as possible.

The relay must be able to inspect, create, update, reassign, reconcile and delete schedule/timesheet records for any employee and any requested date range, subject to existing legal-hold and audit protections.

## Non-goals

- No browser-by-browser entry as the normal path.
- No direct ad-hoc SQL writes from ChatGPT.
- No Netlify deploy per schedule change.
- No plaintext employee or schedule data in GitHub comments, workflow logs or commit statuses.
- PR #73 remains open and is not merged.

## Single control path

All operational schedule and attendance changes use the existing encrypted PR #73 relay:

ChatGPT -> encrypted envelope -> PR #73 issue comment -> GitHub Actions OIDC -> Netlify schedule OIDC trigger -> schedule/attendance assistant -> production repositories.

The relay remains the only normal write path. Browser usage is an explicit emergency fallback only.

## Administrative capabilities

### Schedule

The relay must support:

- list shifts for arbitrary date ranges
- get one shift by ID
- publish/create one or many shifts in a single batch
- update employee identity, date, start/end time, pause, work area, location and note
- delete shifts
- detect exact duplicates, time duplicates and overlaps
- reconcile provisional/guest employee identities to registered portal identities
- bulk-update multiple existing shifts in one command

### Timesheets / attendance

The relay must support:

- list attendance/timesheet data for arbitrary date ranges
- inspect resolved work sessions
- update work start and end
- update pause minutes
- correct employee identity when a provisional identity later becomes registered
- delete selected attendance events when legally allowed
- detect duplicates and inconsistent sessions
- bulk-update multiple sessions in one command

Existing legal holds, audit logs and retention rules remain authoritative and must never be bypassed silently.

## Identity model

Registered portal user IDs are canonical.

When a shift or timesheet record uses a provisional `guest:` identity and exactly one registered employee matches the canonical normalized name, the assistant may rebind the historical records to that registered user ID.

For cases where a short or old name differs from the newly registered full name, the relay must support an explicit scoped rebind command with:

- source employee identity/name
- target registered user ID/name
- from date
- to date
- affected domains: schedule, timesheet or both

The explicit command is required when automatic exact-name reconciliation cannot prove a unique match.

## Range handling

User requests may cover any practical historical range.

The user-facing request remains one logical command. Internally, large ranges are chunked only when required by existing endpoint/database limits. Chunking is transparent and must preserve one final summary.

The relay should avoid fetching entire datasets when the request names an employee or exact range. Filters must be pushed into the underlying reads whenever possible.

## Cost-control rules

For every task, prefer this pattern:

1. One targeted read for the requested employee/range.
2. Compute the minimal set of necessary changes.
3. One encrypted bulk mutation command containing all independent changes that fit safely in one command.
4. One targeted verification read.

Avoid repeated per-day, per-shift or per-employee calls unless a dependency or API limit makes them necessary.

Do not run broad directory syncs or full-history scans when a targeted employee lookup is sufficient.

Do not deploy application code for ordinary schedule/timesheet edits.

## Batch commands

Extend the worker schema with compact bulk administrative actions instead of making many single-record commands. At minimum:

- `bulk-update-shifts`
- `bulk-update-attendance-sessions`
- `rebind-employee-history`

Each command contains a bounded array of changes and one response key. The OIDC trigger returns one encrypted result containing per-item status plus aggregate counts.

If the request exceeds the safe batch size, the client splits it into the fewest possible encrypted batches and performs one final verification.

## Audit and safety

Every mutation records the assistant actor, request/command ID, before/after data where already required, and reason for manual corrections.

Protected attendance events under legal hold cannot be edited or deleted.

Ambiguous employee matches are rejected rather than guessed.

A bulk command may partially succeed only when results are explicit per item; the final response must report rejected items. For identity rebind operations, prefer transactional behavior for each employee/range so schedule and timesheet identity do not diverge.

## Privacy

GitHub receives only encrypted envelopes and privacy-safe aggregate statuses.

No employee names, shift times, attendance timestamps, response keys or decrypted results are written to workflow logs or commit statuses.

Detailed results remain encrypted in the short-retention workflow artifact and are decrypted only by the requesting client.

## Verification

Before claiming completion:

- confirm relay/OIDC status succeeded
- decrypt the detailed result
- run one final targeted list/read for the requested employee and range
- verify employee identity, dates, times, pauses and expected count
- for schedule edits that sync to timesheets, verify the corresponding timesheet records as well

## Example: newly registered employee

Request: Correct Kwame Akakpo from 2026-08-01 through 2026-08-24.

Expected flow:

1. Targeted read of schedule and timesheet rows in that range using the old provisional identity/name and registered Kwame Akakpo identity.
2. Determine the unique registered user ID.
3. Send one `rebind-employee-history` command for schedule + timesheet covering the requested range.
4. Verify the same range once.

No browser entries, no direct SQL write and no per-day loop.

## Success criteria

The design is complete when ChatGPT can handle normal administrative requests such as:

- “Change this employee's pause for the whole month.”
- “Correct all of this employee's shifts from August 1 to August 24.”
- “Move old guest records to the newly registered account.”
- “Correct clock-in/out and pause for these days.”
- “Delete these mistaken time bookings.”

using the encrypted relay with the minimum practical number of calls and with a final verified result.