# PR #73 Reliability and Cost Design

Date: 2026-09-11

## Goal

Make the encrypted PR #73 relay the reliable, low-cost administrative control path for the HABUN employee portal, with special focus on schedule identity correctness, scalable employee resolution, verified mutations, and predictable credit usage.

The design must scale from the current small team to 100+ employees without requiring ChatGPT to remember names manually or create accidental guest identities.

## Primary constraints

- Registered portal user IDs are canonical. Display names are not identity keys.
- No automatic guest/provisional employee creation during normal schedule publishing.
- Ambiguous identity must stop the affected operation instead of guessing.
- Normal schedule work should use the minimum practical number of relay runs.
- Prefer one bounded server-side workflow over per-employee or per-day loops.
- Every mutation must be verified against production state before success is reported.
- Existing encrypted GitHub-comment transport, OIDC trust, audit trail, and security exclusions remain unchanged.
- Browser automation remains an emergency fallback only.

## Cost target

For a normal daily schedule, the target is one encrypted relay run containing:

1. targeted directory resolution for the names present in the requested batch,
2. schedule preflight,
3. the required mutations,
4. server-side post-write verification,
5. one compact encrypted result.

Do not issue one relay request per employee, one request per shift, or one request per day when a bounded batch can perform the same work safely.

For read-heavy maintenance tasks, use the fewest possible calls: normally one targeted inspection and, only if changes are necessary, one mutation batch with built-in verification.

## Phase 1: Canonical employee resolution

### Canonical source

The active portal directory is the source of truth for registered employees. The relay resolves each schedule input to a registered `userId` before any shift is created.

### Resolution order

For each input name:

1. exact canonical full-name match,
2. exact saved alias match,
3. exact unique token match across any name token,
4. conservative fuzzy matching only when the result is unique,
5. ambiguous/not-found result otherwise.

A single-word short name may match any unique token in a registered full name, including the final token. This fixes cases where a commonly used short name is not the first token of the registered full name.

If multiple registered employees match, return candidates and do not write the shift.

### Alias store

Add a small persistent alias mapping keyed by normalized alias with canonical `userId` as the target. Aliases are business metadata, not separate employee identities.

Aliases may be learned or added only through explicit administrative action or an unambiguous confirmed mapping. They must never override an exact canonical-name match.

### User ID first

After resolution, downstream schedule operations receive the canonical `employeeUserId` and canonical current display name. Duplicate detection, updates, history and reporting should prefer `employeeUserId` over names.

## Phase 2: Remove unsafe normal guest fallback

Normal `publish-shifts` must not create a provisional identity because a name was not resolved.

Guest/provisional creation, if still needed for exceptional business cases, becomes a separate explicit operation requiring a clear `approvedUnregisteredNames`/guest-creation intent. It is not enabled by a generic boolean on ordinary publishing.

Existing provisional records remain readable and can be reconciled to registered identities.

## Phase 3: Batch preflight and atomic business behavior

Before writing a schedule batch, resolve and validate the entire batch:

- canonical employee identity,
- valid date and time,
- worksite,
- work area,
- pause policy,
- exact duplicate,
- same-time conflict,
- overlap warning,
- optional business qualification constraints when configured.

If an input is ambiguous or invalid, no silent substitution is allowed.

For ordinary daily schedule publishing, default behavior is all-or-nothing at the business level: if preflight contains a hard error, do not publish a partial plan. The result identifies all failing items in one response so the user can correct them once.

Exact duplicates may be treated as already satisfied and do not count as hard failures.

## Phase 4: Work-area and pause canonicalization

Introduce canonical work-area identifiers for recurring business areas while preserving human-readable labels.

Examples of canonical keys include:

- `zuko`
- `gmp-rundgang`
- `gmp-zuko`
- `brandwache`
- `lager`
- `baureinigung`
- `bauhelfer`

Input spelling/variants are normalized to the canonical area before save.

Pause rules should be represented as configuration/policy keyed by canonical area and time window rather than being reconstructed from conversational memory. Explicit user-provided pauses override defaults only when valid.

This phase must not require extra relay runs; normalization happens inside the same batch request.

## Phase 5: Registration and provisional-history reconciliation

When a new employee account is approved or when requested by an administrator, provide a targeted reconciliation workflow:

1. resolve the canonical registered employee,
2. inspect possible provisional schedule/attendance identities for a bounded date range,
3. auto-rebind only exact, unique, provable matches,
4. return ambiguity without guessing,
5. verify every affected domain after rebind.

This uses the existing employee-history inspection/rebind foundation and should operate as one coordinated relay workflow where practical.

## Phase 6: Server-side verification before success

Every supported mutation must verify its effective production state before the relay returns success.

For schedule publishing/update, verification checks at minimum:

- `shiftId`,
- `employeeUserId`,
- canonical employee name,
- date,
- start/end,
- pause,
- worksite,
- work area,
- status.

A successful GitHub Action or HTTP 200 is not enough. If verification fails, return a conflict/error and never let ChatGPT report the change as completed.

Verification should happen inside the same relay execution when possible so it does not add a second GitHub Actions run.

## Phase 7: Idempotency and concurrent-change protection

Use stable command/item IDs for mutations. Retrying the same command must not create a second shift.

For updates, use the current row/version or updated timestamp as a concurrency guard. If the target changed after it was read, return a stale/conflict result instead of overwriting the newer state.

Batch results must distinguish:

- success,
- already-satisfied/duplicate,
- ambiguous,
- conflict,
- not-found,
- validation failure,
- verification failure.

## Phase 8: Portal health inspection

Add a read-only `portal-health` or equivalent compact inspection action that returns counts and problems rather than dumping all portal data.

Checks should include:

- active registered employee count,
- provisional/guest identities still referenced,
- provisional identities that appear reconcilable to registered employees,
- duplicate/stale employee directory entries,
- schedule rows with unknown/inactive employee IDs,
- exact schedule duplicates/time conflicts,
- invalid/missing worksites,
- unknown/noncanonical work areas,
- attendance identity mismatches,
- recent failed verification/audit anomalies where available.

The health check must be bounded, filterable by date range where relevant, and compact by default. It is an on-demand diagnostic, not a prerequisite for every normal schedule publish.

## Phase 9: Full portal relay consistency

Keep PR #73 as the single normal administrative relay for:

- employees,
- registrations,
- schedule,
- attendance/timesheets,
- corrections,
- worksites,
- company settings,
- reports/exports,
- daily reports,
- schedule templates.

Every admin-visible capability must remain classified in the capability registry as supported, read-only or security-excluded. New admin-visible features should fail CI if they are not classified.

Avoid new parallel control paths.

## Phase 10: Build/source-of-truth cleanup

The current build includes many `apply-*` scripts that rewrite source before tests/build. This can make repository source differ from effective tested source.

For the PR #73 and schedule-critical paths changed by this project:

- fold the final intended implementation into the canonical source files,
- remove or retire obsolete one-time patch scripts after their behavior is incorporated,
- keep migration scripts only when they are intentionally repeatable and tested,
- ensure the relevant tests execute against the same source that is deployed.

The goal is: repository source = tested source = deployed behavior for these critical paths.

This cleanup should be staged and limited to scripts directly affecting the touched relay/schedule behavior; unrelated historical migration scripts are out of scope unless they alter the same files.

## Scalability

The design must work for hundreds of employees without per-employee relay calls.

Directory lookup should load or query the current directory once per server-side batch and reuse it within that operation. Where APIs paginate, the server-side directory loader must consume all pages or use a backend source that guarantees complete enumeration.

The relay response should return only the fields needed for the operation. Large historical datasets must remain range-bounded and filtered.

## Security and privacy

- GitHub comments contain encrypted envelopes only.
- Employee names, schedules and attendance data must not appear in workflow logs/status summaries.
- No secret/environment exposure, arbitrary SQL, arbitrary server code or owner-protection bypass.
- Destructive actions continue to require explicit intent/confirmation according to existing policy.

## Audit

Every mutation retains:

- actor identity,
- command ID and item ID,
- domain/action,
- target IDs,
- before/after values where required,
- reason where applicable,
- verification outcome.

Identity resolution should record privacy-safe resolution status in audit details without exposing unnecessary directory contents.

## Testing strategy

Add regression tests before implementation for at least:

- a unique short token resolving to a two-token registered full name,
- a short token matching multiple employees returning ambiguous,
- ordinary publish refusing unresolved users rather than creating guests,
- explicit guest workflow still working when deliberately requested,
- batch preflight preventing partial publish on a hard identity error,
- canonical user ID stored after short-name resolution,
- exact duplicate idempotency,
- verification failure preventing success,
- concurrent update conflict,
- canonical work-area/pause mapping,
- provisional-to-registered rebind,
- portal-health finding seeded identity/schedule anomalies,
- 100+ employee directory fixture resolving in one server-side batch without per-employee relay calls,
- capability registry completeness,
- critical build tests using canonical source rather than patch-generated source.

## Delivery order

Implement in small reviewable steps:

1. identity resolution + guest safety + regression tests,
2. batch preflight + in-run verification + idempotency,
3. canonical work areas and pause policy,
4. reconciliation workflow,
5. compact portal-health inspection,
6. critical build/source cleanup,
7. full regression and cost-path verification.

Do not combine unrelated portal refactors into this work.

## Success criteria

The project is complete when:

- normal schedule publishing cannot silently create a guest for an existing registered employee,
- short/common names resolve to the correct registered account only when unique,
- ambiguous names stop safely,
- schedule mutations store canonical employee user IDs,
- normal daily schedule publishing typically consumes one PR #73 workflow run,
- large batches do not use per-employee/per-day relay loops,
- mutation success is reported only after production verification,
- existing guest history can be safely reconciled,
- portal health can identify identity/data consistency problems on demand,
- PR #73 remains the single normal admin path for supported portal functions,
- critical relay/schedule behavior is represented directly in canonical source and covered by regression tests.
