# Attendance Timesheet Correction Design

## Goal

Give the authorized ChatGPT schedule/attendance operator a protected way to inspect and correct production attendance data for a bounded date range, so duplicate people, duplicate stamps, wrong session times, and wrong pause values can be repaired without exposing employee data in GitHub logs or editing the unrelated empty Neon main branch.

## Scope

Initial operational scope is 2026-08-01 through 2026-08-12. The same interface may be reused for later bounded ranges.

The first pass must be read-before-write. No attendance event may be edited or removed until the encrypted production read has identified the exact event/session IDs and the correction is unambiguous.

## Architecture

Reuse the existing encrypted GitHub issue-comment -> GitHub OIDC -> Netlify relay already used for schedule management. Extend the existing command parser with namespaced attendance actions instead of creating a second public workflow or a new secret/key pair.

Add a token-protected `attendance-assistant` Netlify function. It connects through the existing `databaseConnectionString()` helper so it reads the same production attendance database as the portal. The OIDC trigger invokes it internally only after the existing GitHub repository/actor/workflow claim checks and RSA/AES command decryption pass.

All detailed attendance responses remain inside the existing AES-256-GCM encrypted result artifact with one-day retention. GitHub workflow logs expose only bounded counts/statuses.

## Commands

### `list-attendance`

Requires `from`, `to`, and a 32-byte response key. Returns:

- attendance events in the requested range with exact event IDs, user IDs, action, client/server time, date, schedule ID, object ID, location status, and offline flag;
- latest pause adjustment per clock-out event;
- schedule shifts in the same range;
- schedule employee directory rows needed to resolve names and stale IDs.

The returned payload is for private comparison only and is encrypted before leaving Netlify.

### `find-attendance-duplicates`

Requires `from`, `to`, and a response key. Returns server-side diagnostics for:

- exact repeated event signatures;
- suspicious repeated clock-in/clock-out session signatures;
- same normalized employee name attached to multiple user IDs in the requested data/directory.

Diagnostics are evidence, not automatic deletion instructions.

### `update-attendance-session`

Requires exact clock-in and clock-out event IDs plus complete corrected clock-in time, clock-out time, pause minutes, and a non-empty reason. It must:

- verify both events exist and belong to the same user;
- verify action types are clock-in/clock-out;
- reject impossible or overlapping time ranges;
- write the updated event times and the latest pause adjustment;
- write an attendance audit entry containing before/after values.

### `delete-attendance-events`

Requires a bounded list of exact event IDs and a non-empty reason. It is intended only for confirmed duplicate/invalid events. It must:

- read every target before deletion;
- refuse events under legal hold;
- audit every deleted event before removal;
- delete only the supplied IDs; location rows/adjustments follow existing foreign-key cascade rules.

The operator must not call this action for ambiguous data.

## Safety Rules

- No plaintext employee or attendance data in GitHub comments, workflow logs, commits, or artifacts.
- No private key retrieval or rotation.
- Reuse the existing OIDC allow-list: repository, repository ID, owner/actor ID, workflow ref, event type, and short token age.
- Limit date ranges to 62 days and delete batches to 25 event IDs.
- Use exact IDs for all writes.
- Keep existing employee self-service and portal role permissions unchanged.
- Do not modify the empty direct Neon main branch.
- Do not create a deploy for each correction. The access feature is deployed once; operational corrections then use the encrypted relay without code deploys.

## Verification

Before production use:

1. command parser tests reject malformed ranges, missing IDs, incomplete session edits, invalid response keys, and oversized deletion batches;
2. assistant-core tests detect cross-user name duplicates and exact duplicate events without merging distinct names;
3. source/contract tests verify the OIDC trigger routes attendance actions only through the protected assistant and still encrypts detailed results;
4. full repository verification/build passes on the feature branch/PR;
5. after merge/deploy, run a read-only `list-attendance` for 2026-08-01..2026-08-12 and decrypt the artifact locally;
6. perform only evidence-backed corrections;
7. repeat the read and compare the final production state before claiming completion.
