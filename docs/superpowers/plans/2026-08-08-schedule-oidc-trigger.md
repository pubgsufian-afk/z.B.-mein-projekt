# Schedule OIDC Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable build/scheduled relay with a GitHub Actions OIDC-authenticated Netlify trigger that decrypts the existing schedule envelope and invokes the existing Dienstplan-Assistent without direct database writes or long-lived GitHub secrets.

**Architecture:** A push on `main` that changes the encrypted schedule envelope or its trigger file starts a dedicated GitHub Actions workflow with only `contents: read` and `id-token: write`. The workflow obtains a short-lived GitHub OIDC JWT and POSTs that JWT plus the encrypted envelope to a new Netlify function. The function verifies GitHub's RS256 signature and exact claims, decrypts the envelope with the Netlify-only private key, validates the existing command contract, and internally calls `schedule-assistant.mts` with the existing Netlify-only assistant token. Legacy build/runtime triggers are disabled after the OIDC path is proven live.

**Tech Stack:** Node.js 22/24, TypeScript `.mts` Netlify Functions, Node `crypto`, GitHub Actions OIDC, existing RSA-OAEP-256 + AES-256-GCM envelope, existing Neon schedule repository and Dienstplan-Assistent.

## Global Constraints

- No direct SQL/database writes from ChatGPT or GitHub Actions.
- No general HTTP proxy and no human service-account password.
- No long-lived Habun/Netlify bearer secret stored in GitHub.
- Workflow permissions are exactly `contents: read` and `id-token: write`.
- Accepted issuer is exactly `https://token.actions.githubusercontent.com`.
- Accepted audience is exactly `habun-schedule-assistant`.
- Accepted repository is exactly `pubgsufian-afk/z.B.-mein-projekt`.
- Accepted ref is exactly `refs/heads/main`.
- Accepted subject is exactly `repo:pubgsufian-afk/z.B.-mein-projekt:ref:refs/heads/main`.
- Accepted workflow ref is exactly `pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main`.
- OIDC JWT algorithm must be `RS256`; signature is verified against GitHub's fixed JWKS endpoint `https://token.actions.githubusercontent.com/.well-known/jwks`.
- The encrypted command remains version 1, algorithm `RSA-OAEP-256+A256GCM`, and must be no more than 30 minutes old with at most 5 minutes of future clock skew.
- Missing/ambiguous employees are never guessed; only exact active matches may be published.
- Existing duplicate detection and overlap warnings remain authoritative.
- No CORS headers are added.
- Do not report a schedule as entered until live Neon rows are verified.

---

### Task 1: GitHub OIDC verifier

**Files:**
- Create: `netlify/functions/_shared/schedule-github-oidc.mts`
- Create: `scripts/schedule-github-oidc-test.mjs`

**Interfaces:**
- Produces: `verifyScheduleGithubOidc(token: string, now?: Date, fetchImpl?: typeof fetch): Promise<ScheduleGithubOidcClaims>`
- Produces: `validateScheduleGithubOidcClaims(claims: Record<string, unknown>, now?: Date): ScheduleGithubOidcClaims`
- Consumes: GitHub JWKS JSON containing `keys[]` with an RSA key matching JWT `kid`.

- [ ] **Step 1: Write the failing unit test**

Create `scripts/schedule-github-oidc-test.mjs` with a generated RSA test key. Build an RS256 JWT containing the exact required issuer, audience, repository, ref, subject and workflow ref. Assert acceptance, then add negative assertions for wrong audience, wrong repository, wrong ref, wrong workflow ref, expired token, future `nbf`, non-RS256 `alg`, unknown `kid`, and invalid signature.

```js
const claims = await verifyScheduleGithubOidc(validToken, now, fakeFetch)
assert.equal(claims.repository, 'pubgsufian-afk/z.B.-mein-projekt')
assert.equal(claims.ref, 'refs/heads/main')
await assert.rejects(() => verifyScheduleGithubOidc(wrongRepoToken, now, fakeFetch), /repository/i)
await assert.rejects(() => verifyScheduleGithubOidc(invalidSignatureToken, now, fakeFetch), /signature/i)
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
node --experimental-strip-types scripts/schedule-github-oidc-test.mjs
```

Expected: failure because `schedule-github-oidc.mts` does not exist.

- [ ] **Step 3: Implement the minimal verifier**

Create `netlify/functions/_shared/schedule-github-oidc.mts`. Decode JWT segments with base64url, reject anything except `alg: RS256`, fetch only the fixed GitHub JWKS URL, select the RSA key by `kid`, construct a public key using `createPublicKey({ key: jwk, format: 'jwk' })`, and verify with `verify('RSA-SHA256', signingInput, publicKey, signature)`.

```ts
const EXPECTED = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'habun-schedule-assistant',
  repository: 'pubgsufian-afk/z.B.-mein-projekt',
  ref: 'refs/heads/main',
  sub: 'repo:pubgsufian-afk/z.B.-mein-projekt:ref:refs/heads/main',
  workflow_ref: 'pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main',
} as const
```

Require finite `iat`, `nbf`, and `exp`; reject if `nbf > now + 30s`, `exp <= now - 30s`, `iat > now + 30s`, or `now - iat > 10 minutes`.

- [ ] **Step 4: Run the focused test and confirm GREEN**

```bash
node --experimental-strip-types scripts/schedule-github-oidc-test.mjs
```

Expected: `Schedule GitHub OIDC tests passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/schedule-github-oidc.mts scripts/schedule-github-oidc-test.mjs
git commit -m "feat: verify GitHub OIDC for schedule relay"
```

---

### Task 2: Runtime envelope decryption and OIDC trigger function

**Files:**
- Create: `netlify/functions/_shared/schedule-command-envelope-runtime.mts`
- Create: `netlify/functions/schedule-oidc-trigger.mts`
- Create: `scripts/schedule-oidc-trigger-source-test.mjs`
- Modify: `scripts/schedule-command-envelope-test.mjs`

**Interfaces:**
- Consumes: `verifyScheduleGithubOidc(...)` from Task 1.
- Consumes: `parseScheduleCommand(raw: unknown, now?: Date)` from `netlify/functions/_shared/schedule-command-worker-core.mts`.
- Consumes: default export from `netlify/functions/schedule-assistant.mts`.
- Produces: POST endpoint `/api/schedule-oidc-trigger` accepting `{ oidcToken, envelope }`.

- [ ] **Step 1: Add failing source/contract tests**

`scripts/schedule-oidc-trigger-source-test.mjs` must assert that the function imports the OIDC verifier, verifies before decrypting, reads `SCHEDULE_COMMAND_PRIVATE_KEY_B64` and `SCHEDULE_ASSISTANT_TOKEN` only via `Netlify.env.get`, calls the assistant internally, exposes only `/api/schedule-oidc-trigger`, accepts only POST, contains no CORS header, contains no `database.pool.query`, and does not import attendance/account/role mutation modules.

Extend envelope tests so the runtime decryptor is tested against the same generated RSA/AES envelope contract as the existing build decryptor.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
```

Expected: failure because the new runtime module/function do not exist.

- [ ] **Step 3: Implement runtime decryption**

Create `schedule-command-envelope-runtime.mts` using Node `privateDecrypt` with RSA-OAEP SHA-256 and `createDecipheriv('aes-256-gcm', ...)`. Enforce envelope version 1, state `command`, algorithm `RSA-OAEP-256+A256GCM`, 32-byte AES key, 12-byte IV and 16-byte GCM tag. Return the parsed JSON object and never log plaintext.

- [ ] **Step 4: Implement the OIDC trigger**

`POST /api/schedule-oidc-trigger` flow:

```ts
const body = await request.json()
await verifyScheduleGithubOidc(String(body.oidcToken || ''))
const privateKeyPem = Buffer.from(Netlify.env.get('SCHEDULE_COMMAND_PRIVATE_KEY_B64') || '', 'base64').toString('utf8')
const command = decryptScheduleCommandEnvelopeRuntime(body.envelope, privateKeyPem)
const parsed = parseScheduleCommand(JSON.stringify(command), new Date())
if (!parsed.ok) return json({ message: parsed.message }, 400)
const assistantToken = Netlify.env.get('SCHEDULE_ASSISTANT_TOKEN') || ''
```

Call `scheduleAssistant` internally with a synthetic POST request and `Authorization: Bearer ${assistantToken}`. For `publish-shifts`, pass `requestId: command.commandId` and at most 100 shifts. Return only:

```ts
{
  commandHash,
  action,
  employeeCount,
  publishedCount,
  duplicateCount,
  rejectedCount,
  results: [{ index, status }]
}
```

Do not return employee names, OIDC claims, tokens, plaintext envelope contents, or secrets.

- [ ] **Step 5: Run focused tests and confirm GREEN**

```bash
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/schedule-command-envelope-test.mjs
node --experimental-strip-types scripts/schedule-github-oidc-test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/schedule-command-envelope-runtime.mts netlify/functions/schedule-oidc-trigger.mts scripts/schedule-oidc-trigger-source-test.mjs scripts/schedule-command-envelope-test.mjs
git commit -m "feat: add OIDC schedule trigger function"
```

---

### Task 3: Dedicated GitHub Actions relay and verification wiring

**Files:**
- Create: `.github/workflows/schedule-oidc-publish.yml`
- Create: `scripts/run-schedule-oidc-relay.mjs`
- Create: `scripts/schedule-oidc-workflow-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ops/schedule-command.envelope.json`.
- Calls: `https://habun-mitarbeiterportal.netlify.app/api/schedule-oidc-trigger`.
- Produces: a workflow summary containing only command hash and numeric/status counts.

- [ ] **Step 1: Write failing workflow source test**

The test must assert:

```yaml
permissions:
  contents: read
  id-token: write
```

It must also assert that the workflow triggers only on pushes to `main` when `ops/schedule-command.envelope.json` or `ops/schedule-command-trigger.txt` changes. It must not reference `SCHEDULE_ASSISTANT_TOKEN`, `SCHEDULE_ASSISTANT_BRIDGE_TOKEN`, `SCHEDULE_COMMAND_PRIVATE_KEY_B64`, `secrets.`, database URLs, or write permissions other than `id-token: write`.

- [ ] **Step 2: Run and confirm RED**

```bash
node scripts/schedule-oidc-workflow-source-test.mjs
```

Expected: failure because the workflow does not exist.

- [ ] **Step 3: Add relay helper**

Create `scripts/run-schedule-oidc-relay.mjs`. Require `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, request audience `habun-schedule-assistant`, extract only the returned `value`, read the encrypted envelope, and POST `{ oidcToken, envelope }` to the fixed Netlify endpoint. Print only:

```text
Habun schedule OIDC relay: published=X duplicate=Y rejected=Z
```

Exit nonzero for HTTP errors or `rejectedCount > 0`; do not print unexpected response bodies.

- [ ] **Step 4: Add workflow**

Create `.github/workflows/schedule-oidc-publish.yml`:

```yaml
name: Habun schedule OIDC relay
on:
  push:
    branches: [main]
    paths:
      - ops/schedule-command.envelope.json
      - ops/schedule-command-trigger.txt
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node scripts/run-schedule-oidc-relay.mjs
```

- [ ] **Step 5: Wire tests into `verify:unified`**

Append after the existing schedule command tests:

```text
node --experimental-strip-types scripts/schedule-github-oidc-test.mjs
node scripts/schedule-oidc-trigger-source-test.mjs
node scripts/schedule-oidc-workflow-source-test.mjs
```

- [ ] **Step 6: Run focused and full verification**

```bash
node scripts/schedule-oidc-workflow-source-test.mjs
npm run verify
npm run build
npm run test:e2e
```

Expected: all pass. If latest `main` still has the known second-verify mutation regression inside `npm run build`, fix that independent regression without weakening OIDC tests.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/schedule-oidc-publish.yml scripts/run-schedule-oidc-relay.mjs scripts/schedule-oidc-workflow-source-test.mjs package.json
git commit -m "feat: relay schedule commands with GitHub OIDC"
```

---

### Task 4: Retire legacy trigger paths, deploy, and publish Saturday schedule

**Files:**
- Modify: `package.json`
- Modify: `scripts/apply-schedule-command-worker.mjs`
- Modify: `netlify/functions/schedule-assistant.mts` when the branch source contains `SCHEDULE_ASSISTANT_BRIDGE_TOKEN`
- Modify: `ops/schedule-command.envelope.json` only after the OIDC function is live
- Modify: `ops/schedule-command-trigger.txt` only when a fresh trigger commit is needed
- Netlify configuration: keep `SCHEDULE_COMMAND_PRIVATE_KEY_B64` and `SCHEDULE_ASSISTANT_TOKEN`; remove obsolete command/bridge variables after successful rollout

**Interfaces:**
- OIDC trigger becomes the sole active ChatGPT-to-scheduler execution path.
- Existing `schedule-assistant` remains the sole component allowed to create shifts.

- [ ] **Step 1: Disable the build relay**

Remove `node scripts/process-schedule-command-build.mjs` from the `build` script. Keep the encrypted envelope format and public key.

- [ ] **Step 2: Remove legacy bridge-token authorization**

Update `scripts/apply-schedule-command-worker.mjs` so it no longer patches `SCHEDULE_ASSISTANT_BRIDGE_TOKEN` into `schedule-assistant.mts`. If the branch source already contains bridge-token authorization, remove it so `schedule-assistant` accepts only `SCHEDULE_ASSISTANT_TOKEN`. Preserve the `sync-directory` action.

Update source tests to assert `SCHEDULE_ASSISTANT_BRIDGE_TOKEN` is absent from the assistant and OIDC workflow.

- [ ] **Step 3: Full pre-merge verification**

```bash
npm run verify
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Require successful GitHub verification, successful Netlify deploy preview, and zero secret-scan matches before merge.

- [ ] **Step 4: Merge and verify production function**

Merge only the verified PR rebased/refreshed onto the latest `main`. Confirm production deploy is `ready`, branch `main`, and `schedule-oidc-trigger` appears in `available_functions` with route `/api/schedule-oidc-trigger`.

- [ ] **Step 5: Ensure runtime secrets without exposing values**

`SCHEDULE_COMMAND_PRIVATE_KEY_B64` must be available to production Functions/Runtime. `SCHEDULE_ASSISTANT_TOKEN` must remain available to production Functions/Runtime. If the private-key scope cannot be changed without re-entering its value, generate a new RSA-2048 keypair at rollout time, set the base64-encoded private PEM directly as a secret in Netlify, and commit only the generated public PEM to `ops/schedule-command-public.pem`. Never print the private key.

- [ ] **Step 6: Remove obsolete Netlify trigger variables after OIDC is proven**

Delete `SCHEDULE_ASSISTANT_COMMAND_RUNTIME` and `SCHEDULE_ASSISTANT_BRIDGE_TOKEN` from Netlify after one successful OIDC invocation. The scheduled worker may remain deployed temporarily with no command secret and can be removed later without blocking this rollout.

- [ ] **Step 7: Generate a fresh encrypted Saturday command**

At execution time, construct the plaintext in memory with these exact values and generate freshness fields programmatically:

```js
const command = {
  version: 1,
  commandId: `saturday-2026-08-08-${crypto.randomUUID()}`,
  createdAt: new Date().toISOString(),
  action: 'publish-shifts',
  shifts: [
    { employeeName: 'Aras', date: '2026-08-08', start: '06:00', end: '17:00', workArea: 'ZuKo', pauseMinutes: 0 },
    { employeeName: 'Amin', date: '2026-08-08', start: '07:00', end: '17:00', workArea: 'GMP ZuKo', pauseMinutes: 0 },
    { employeeName: 'Sarmad', date: '2026-08-08', start: '07:00', end: '17:00', workArea: 'GMP Bereich', pauseMinutes: 0 },
  ],
}
```

Encrypt that object with `ops/schedule-command-public.pem` using the existing RSA-OAEP-256 + AES-256-GCM envelope format. Commit only the encrypted envelope to `main`. If GitHub sees no envelope content change, update `ops/schedule-command-trigger.txt` with `schedule-oidc-${crypto.randomUUID()}`; this trigger contains no schedule data.

- [ ] **Step 8: Verify workflow execution**

Confirm the `Habun schedule OIDC relay` run was triggered by the exact command commit. Its log may show only numeric counts/statuses and must not expose OIDC JWTs, plaintext names/times, private keys, assistant tokens, or database credentials.

- [ ] **Step 9: Verify live Neon rows before reporting success**

Run a read-only query against production:

```sql
SELECT employee_name, date, start_time, end_time, work_area, status, source
FROM schedule_shifts
WHERE date = DATE '2026-08-08'
  AND employee_name IN ('Aras', 'Amin', 'Sarmad')
ORDER BY employee_name, start_time;
```

Read recent `schedule_audit_log` entries for actor `dienstplan-assistent` and action `shift-published` as a second check. Only report each employee as entered if the corresponding live row exists. If Amin or Sarmad are not registered/active, report them as not entered rather than creating guessed employee records. Exact duplicates count as already entered and are not recreated.

- [ ] **Step 10: Final security check**

Confirm all of these statements are true:

```text
GitHub workflow permissions: contents: read + id-token: write only
No GitHub repository secret required
OIDC issuer/audience/repository/ref/subject/workflow_ref exact-match validation active
No CORS
No direct DB write in OIDC function
Legacy build relay disabled
Legacy runtime command secret deleted
Live schedule verified before user confirmation
```

- [ ] **Step 11: Commit rollout cleanup**

```bash
git add package.json scripts/apply-schedule-command-worker.mjs netlify/functions/schedule-assistant.mts
git commit -m "chore: retire legacy schedule relay paths"
```
