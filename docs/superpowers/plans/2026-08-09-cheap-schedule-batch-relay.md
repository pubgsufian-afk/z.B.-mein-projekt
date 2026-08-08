# Günstiger Dienstplan-Batch-Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dienstpläne als einen verschlüsselten Batch ohne Repository-Dateiänderung und ohne Netlify-Deploy pro Auftrag über einen streng geschützten GitHub-PR-Kommentar auslösen.

**Architecture:** PR #73 bleibt der feste technische Kanal. Ein `issue_comment`-Workflow akzeptiert nur neu erstellte, markierte Kommentare des festen Owner-Accounts, liest den verschlüsselten Envelope direkt aus dem Event und sendet ihn mit kurzlebigem GitHub OIDC an die bestehende Netlify-Route. Die Portal-Oberfläche und die fachliche Scheduler-Write-Logik bleiben unverändert.

**Tech Stack:** GitHub Actions, Node.js 22, GitHub OIDC, Netlify Functions, TypeScript/ESM, bestehende RSA-OAEP-256 + AES-256-GCM Envelope-Verschlüsselung

## Global Constraints

- Keine direkte Neon-Schreibverbindung.
- Keine Netlify-/Datenbank-Secrets in GitHub.
- Keine Klartext-Mitarbeiterdaten im technischen Kommentar.
- Nur PR #73, Repository-ID 1184469401, Owner-ID/Actor-ID 249184348 und der bestehende Workflow dürfen veröffentlichen.
- Nur `issue_comment.created` darf einen neuen Auftrag auslösen; Editieren darf nicht erneut veröffentlichen.
- Maximal 100 Schichten pro Batch bleiben unverändert.
- Manuelles Eintragen im Portal bleibt unverändert.
- Keine Änderung an Dienstplan-PDF, Zeiterfassung, Rollen oder Benutzeroberfläche.

---

### Task 1: Workflow-Vertrag auf kommentarbasierten Relay umstellen

**Files:**
- Modify: `.github/workflows/schedule-oidc-publish.yml`
- Modify: `scripts/schedule-oidc-workflow-source-test.mjs`

**Interfaces:**
- Consumes: GitHub event `issue_comment.created`.
- Produces env: `SCHEDULE_ENVELOPE_COMMENT` mit dem markierten verschlüsselten Kommentarinhalt.

- [ ] **Step 1: Failing source test schreiben**

Der Test muss verlangen:

```js
assert.match(workflow, /issue_comment:/)
assert.match(workflow, /types:\s*\[[^\]]*created[^\]]*\]/)
assert.doesNotMatch(workflow, /pull_request:/)
assert.match(workflow, /github\.event\.issue\.number\s*==\s*73/)
assert.match(workflow, /github\.event\.issue\.pull_request/)
assert.match(workflow, /github\.actor_id\s*==\s*['"]249184348['"]/)
assert.match(workflow, /startsWith\(github\.event\.comment\.body,\s*['"]<!-- habun-schedule-envelope-v1 -->['"]\)/)
assert.match(workflow, /SCHEDULE_ENVELOPE_COMMENT:/)
assert.match(workflow, /github\.event\.comment\.body/)
```

Der bestehende Test auf `pull_request`, `synchronize`, Head-Branch und Envelope-Dateipfad wird entfernt. Die Verbote für Secrets, `contents: write`, Datenbank-URLs und andere Schreibrechte bleiben.

- [ ] **Step 2: RED über PR-CI bestätigen**

Committe nur den Test und öffne/aktualisiere einen Draft-PR. Erwartung: `schedule-oidc-workflow-source-test.mjs` schlägt fehl, weil der aktuelle Workflow noch `pull_request` nutzt.

- [ ] **Step 3: Workflow minimal ändern**

Zielinhalt:

```yaml
name: Habun schedule OIDC relay

on:
  issue_comment:
    types: [created]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    if: >-
      github.repository == 'pubgsufian-afk/z.B.-mein-projekt' &&
      github.event.issue.pull_request &&
      github.event.issue.number == 73 &&
      github.actor_id == '249184348' &&
      startsWith(github.event.comment.body, '<!-- habun-schedule-envelope-v1 -->')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node scripts/run-schedule-oidc-relay.mjs
        env:
          SCHEDULE_ENVELOPE_COMMENT: ${{ github.event.comment.body }}
```

- [ ] **Step 4: Source test grün bestätigen**

PR-CI muss den Workflow-Source-Test bestehen.

---

### Task 2: Relay liest verschlüsselten Envelope aus dem Event statt aus Git

**Files:**
- Modify: `scripts/run-schedule-oidc-relay.mjs`
- Modify: `scripts/schedule-oidc-workflow-source-test.mjs`

**Interfaces:**
- Consumes env: `SCHEDULE_ENVELOPE_COMMENT`.
- Marker: `<!-- habun-schedule-envelope-v1 -->`.
- Payload: direkt danach genau ein JSON-Objekt des bestehenden Envelope-Schemas.

- [ ] **Step 1: Failing assertions ergänzen**

```js
assert.match(relay, /SCHEDULE_ENVELOPE_COMMENT/)
assert.match(relay, /habun-schedule-envelope-v1/)
assert.doesNotMatch(relay, /readFile/)
assert.doesNotMatch(relay, /ops\/schedule-command\.envelope\.json/)
```

- [ ] **Step 2: RED bestätigen**

Erwartung: Test schlägt fehl, solange `run-schedule-oidc-relay.mjs` noch `readFile(ENVELOPE_PATH)` verwendet.

- [ ] **Step 3: Minimalen Parser implementieren**

```js
const ENVELOPE_MARKER = '<!-- habun-schedule-envelope-v1 -->'

function envelopeFromComment(value) {
  const comment = String(value || '')
  if (!comment.startsWith(ENVELOPE_MARKER)) throw new Error('Ungültiger Dienstplan-Envelope-Marker')
  const raw = comment.slice(ENVELOPE_MARKER.length).trim()
  const envelope = JSON.parse(raw)
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Ungültiger Dienstplan-Envelope')
  }
  return envelope
}

const envelope = envelopeFromComment(requiredEnv('SCHEDULE_ENVELOPE_COMMENT'))
```

Keine Ausgabe von Kommentar, Envelope, OIDC-Token oder Mitarbeiterdaten in Logs.

- [ ] **Step 4: Source test grün bestätigen**

---

### Task 3: OIDC-Verifier auf `issue_comment` + main festziehen

**Files:**
- Modify: `netlify/functions/_shared/schedule-github-oidc.mts`
- Modify: `scripts/schedule-github-oidc-test.mjs`

**Interfaces:**
- Expected event: `issue_comment`.
- Expected ref: `refs/heads/main`.
- Expected workflow ref: `pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main`.
- Expected subject: normaler oder immutable `ref:refs/heads/main`-Subject.

- [ ] **Step 1: Tests zuerst umstellen**

Testpayload:

```js
event_name: 'issue_comment'
ref: 'refs/heads/main'
sub: 'repo:pubgsufian-afk@249184348/z.B.-mein-projekt@1184469401:ref:refs/heads/main'
workflow_ref: 'pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main'
```

Zusätzlich müssen `pull_request`, falscher Actor, falscher Ref und falscher Workflow weiterhin abgelehnt werden.

- [ ] **Step 2: RED bestätigen**

Erwartung: aktuelle Verifier-Konstanten erwarten noch `pull_request` und `refs/pull/73/merge`.

- [ ] **Step 3: Verifier minimal ändern**

Setze:

```ts
const EXPECTED_EVENT_NAME = 'issue_comment'
const EXPECTED_REF = 'refs/heads/main'
const LEGACY_SUBJECT = 'repo:pubgsufian-afk/z.B.-mein-projekt:ref:refs/heads/main'
const IMMUTABLE_SUBJECT = 'repo:pubgsufian-afk@249184348/z.B.-mein-projekt@1184469401:ref:refs/heads/main'
const EXPECTED_WORKFLOW_REF = 'pubgsufian-afk/z.B.-mein-projekt/.github/workflows/schedule-oidc-publish.yml@refs/heads/main'
```

Repository, repository_id, repository_owner_id, actor_id, audience, issuer, RS256, JWKS und Token-Alter bleiben unverändert streng geprüft.

- [ ] **Step 4: OIDC-Test grün bestätigen**

---

### Task 4: Vollständige Regression und Rollout

**Files:**
- Verify existing repository
- No portal UI/API schema changes

- [ ] **Step 1: `npm run verify` grün**
- [ ] **Step 2: `npm run build` grün**
- [ ] **Step 3: `npm run test:e2e` grün**
- [ ] **Step 4: Diff prüfen**

Runtime-Änderungen dürfen nur diese Dateien betreffen:

```text
.github/workflows/schedule-oidc-publish.yml
scripts/run-schedule-oidc-relay.mjs
netlify/functions/_shared/schedule-github-oidc.mts
scripts/schedule-oidc-workflow-source-test.mjs
scripts/schedule-github-oidc-test.mjs
```

plus Dokumentation.

- [ ] **Step 5: PR mergen und einmaligen Production-Deploy abwarten**

Dieser einmalige Deploy installiert die neue OIDC-Verifier-Version. Danach erzeugen Dienstplan-Aufträge keine Git-Dateiänderung mehr.

- [ ] **Step 6: Sicheren End-to-End-Test ohne neue Schicht durchführen**

Verwende einen frischen verschlüsselten Auftrag, der exakt auf eine bereits vorhandene Schicht zeigt. Poste ihn mit Marker als neuen Kommentar an PR #73. Erwartung: Workflow erfolgreich, `published=0`, `duplicate>=1`, `rejected=0`. Dadurch wird der neue Transportweg bewiesen, ohne eine zusätzliche Schicht anzulegen.

- [ ] **Step 7: Technischen Kommentar nach erfolgreicher Verifikation neutralisieren**

Kommentar auf `Habun Dienstplan-Auftrag verarbeitet.` ändern. Da nur `issue_comment.created` lauscht, darf das Editieren keinen zweiten Lauf auslösen.
