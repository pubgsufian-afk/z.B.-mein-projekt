# Permanent Schedule Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen dauerhaften, verschlüsselten ChatGPT→GitHub→Netlify→Dienstplan-Assistent-Zugang bereitstellen, mit dem aktive Mitarbeiter synchronisiert und eindeutige Dienste ohne manuelle Portal-Schritte veröffentlicht werden können.

**Architecture:** Ein GitHub-Issue trägt nur einen verschlüsselten Command-Umschlag. Ein Actions-Workflow reagiert ausschließlich auf Issues des Repository-Besitzers und ruft die Netlify-Bridge mit Repository und Issue-Nummer auf. Die Bridge verifiziert das Issue über die GitHub-API, entschlüsselt den Command mit einem Netlify-Secret und ruft intern den bestehenden `schedule-assistant` auf; Idempotenz wird in Netlify Blobs gespeichert.

**Tech Stack:** Netlify Functions, Netlify Blobs, Node.js `crypto`, GitHub Actions, bestehender Neon-Schedule-Repository-Layer, Node-Testskripte.

## Global Constraints

- Keine direkten ChatGPT-Schreibzugriffe auf Neon.
- Keine Passwörter, privaten Schlüssel oder Dienstplan-Klartexte in GitHub.
- Keine CORS-Freigabe.
- Nur Repository `pubgsufian-afk/z.B.-mein-projekt` und Issue-Autor `pubgsufian-afk` dürfen Commands auslösen.
- Unbekannte oder mehrdeutige Mitarbeiternamen dürfen nie geraten werden.
- Exakte Wiederholungen dürfen keine doppelten Dienste erzeugen.
- Audit-Akteur bleibt `dienstplan-assistent`.
- Bestehende Portal-, Rollen-, Standort-, Zeiterfassungs-, PDF- und Exportfunktionen dürfen nicht regressieren.

---

### Task 1: Bridge-Vertrag und Verschlüsselungs-Helfer

**Files:**
- Create: `scripts/schedule-command-bridge-test.mjs`
- Create: `netlify/functions/_shared/schedule-command-crypto.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `decryptScheduleCommand(envelope, privateKeyPem)` und `validateScheduleCommand(command, now)`.
- Command-Form: `{ version: 1, commandId: string, createdAt: string, action: 'sync-directory' | 'publish-shifts', shifts?: unknown[] }`.

- [ ] **Step 1: Write the failing test**

Test erzeugt lokal ein RSA-Schlüsselpaar, verschlüsselt eine JSON-Nutzlast hybrid mit AES-256-GCM + RSA-OAEP/SHA-256 und erwartet, dass `decryptScheduleCommand` exakt die Nutzlast zurückgibt. Weitere Assertions prüfen falsche Version, abgelaufene `createdAt`-Zeit und nicht erlaubte Aktionen.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types scripts/schedule-command-bridge-test.mjs`
Expected: FAIL, weil `schedule-command-crypto.mts` noch nicht existiert.

- [ ] **Step 3: Write minimal implementation**

Implementiere Base64-Dekodierung, RSA-OAEP/SHA-256-Schlüsselentschlüsselung, AES-256-GCM-Nutzlastentschlüsselung und die erlaubte Command-Validierung. Maximalalter: 30 Minuten; `commandId` muss nicht leer sein.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types scripts/schedule-command-bridge-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `test: define encrypted schedule command contract`

### Task 2: Dienstplan-Assistent um Directory-Sync ergänzen

**Files:**
- Modify: `scripts/schedule-assistant-source-test.mjs`
- Modify: `netlify/functions/schedule-assistant.mts`

**Interfaces:**
- Consumes: bestehendes `activePortalEmployees()`.
- Produces: geschützte Aktion `sync-directory`, Rückgabe nur `{ integration, role, employeeCount }`.

- [ ] **Step 1: Write the failing test**

Erweitere den Source-Test um die Anforderung, dass `schedule-assistant.mts` die Aktion `sync-directory` kennt, `activePortalEmployees()` aufruft und nur die Anzahl zurückgibt.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/schedule-assistant-source-test.mjs`
Expected: FAIL, weil `sync-directory` noch fehlt.

- [ ] **Step 3: Write minimal implementation**

Füge nach dem Laden der aktiven Mitarbeiter den `sync-directory`-Zweig ein und gib keine Namen oder Benutzer-IDs zurück.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/schedule-assistant-source-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: allow protected schedule directory sync`

### Task 3: Netlify-Bridge mit Issue-Verifikation und Idempotenz

**Files:**
- Create: `scripts/schedule-command-bridge-source-test.mjs`
- Create: `netlify/functions/schedule-command-bridge.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `decryptScheduleCommand`, `validateScheduleCommand`, `schedule-assistant` und Netlify Blobs.
- HTTP Input: `{ repository: string, issueNumber: number }`.
- Output: `{ commandId, status: 'processed' | 'duplicate', publishedCount, rejectedCount, employeeCount? }` ohne Mitarbeiterdaten.

- [ ] **Step 1: Write the failing test**

Source-Test verlangt feste Repo-/Autorprüfung, Titelpräfix `[dienstplan-command]`, Lesen des privaten Schlüssels nur aus `Netlify.env`, starken Blob-Store für `processed/<commandId>`, internen Aufruf des vorhandenen Schedule-Assistant und keine CORS-Header.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/schedule-command-bridge-source-test.mjs`
Expected: FAIL, weil die Bridge noch fehlt.

- [ ] **Step 3: Write minimal implementation**

Bridge akzeptiert nur POST, lädt das Issue von `api.github.com`, prüft Repo, Autor und Titel, parst den verschlüsselten JSON-Umschlag, entschlüsselt und validiert den Command, prüft `processed/<commandId>`, erzeugt intern einen Request an `schedule-assistant` mit `SCHEDULE_ASSISTANT_TOKEN`, speichert nur das minimale Ergebnis im Blob und gibt es zurück.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/schedule-command-bridge-source-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add encrypted schedule command bridge`

### Task 4: GitHub-Issue-Auslöser

**Files:**
- Create: `scripts/schedule-command-workflow-test.mjs`
- Create: `.github/workflows/schedule-command-bridge.yml`
- Modify: `package.json`

**Interfaces:**
- Trigger: `issues` / `opened`.
- Filter: Issue-Autor `pubgsufian-afk`, Titel beginnt mit `[dienstplan-command]`.
- Calls: `https://habun-mitarbeiterportal.netlify.app/api/schedule-command-bridge` mit Repository und Issue-Nummer.
- Result comment: nur `commandId`, Status und aggregierte Zähler; danach Issue schließen.

- [ ] **Step 1: Write the failing test**

Test liest YAML als Text und verlangt Issue-Trigger, Owner-Filter, Titelpräfix, Produktions-Bridge-URL, keinen eingebetteten Token und einen abschließenden Issue-Kommentar/Close-Schritt.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/schedule-command-workflow-test.mjs`
Expected: FAIL, weil der Workflow noch fehlt.

- [ ] **Step 3: Write minimal implementation**

Workflow nutzt `curl` für den Bridge-Aufruf und `actions/github-script` mit dem automatisch bereitgestellten `GITHUB_TOKEN`, um ausschließlich das minimale Ergebnis zu kommentieren und das Command-Issue zu schließen.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/schedule-command-workflow-test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: trigger schedule bridge from owner issues`

### Task 5: Schlüssel, Gesamtprüfung und Live-Verifikation

**Files:**
- Create: `docs/integration/schedule-bridge-public.pem`
- Modify: `package.json` only if final test-chain integration is still missing.

**Interfaces:**
- Netlify secret: `SCHEDULE_BRIDGE_PRIVATE_KEY_B64` in production/functions/runtime.
- Public key: repository file above.

- [ ] **Step 1: Generate production key pair**

Erzeuge ein neues RSA-Schlüsselpaar. Committe ausschließlich den öffentlichen Schlüssel. Übertrage den privaten PEM-Inhalt Base64-kodiert als geheime Produktionsvariable nach Netlify; gib den Wert nie im Chat oder Repository aus.

- [ ] **Step 2: Run full verification**

Run through CI: `npm run verify`, `npm run build`, `npm run test:e2e`.
Expected: alle Schritte PASS.

- [ ] **Step 3: Deploy through PR**

PR gegen `main`; erst nach grüner Verify-/Build-/E2E-Pipeline mergen. Danach Netlify-Produktionsdeploy mit genau diesem Merge-Commit verifizieren und prüfen, dass `schedule-command-bridge` und `schedule-assistant` als Functions vorhanden sind.

- [ ] **Step 4: End-to-end directory command**

ChatGPT liest den öffentlichen Schlüssel, verschlüsselt `{ action: 'sync-directory' }`, erstellt ein Command-Issue und wartet auf den minimalen Workflow-Kommentar. Anschließend liest ChatGPT `schedule_employees` aus Neon und bestätigt Anzahl und aktive Namen.

- [ ] **Step 5: End-to-end shift command**

ChatGPT verschlüsselt den vom Nutzer freigegebenen Samstagsdienst für einen eindeutig registrierten Mitarbeiter, erstellt ein Command-Issue, wartet auf Verarbeitung und verifiziert den resultierenden Shift anschließend lesend in Neon.

- [ ] **Step 6: Final safety verification**

Prüfe, dass Issue-Inhalt nur Ciphertext enthält, Action-Kommentar keine Namen/Zeiten/Orte enthält, keine Secrets im Deploy-Scan auftauchen und eine wiederholte Command-ID keinen zweiten Dienst erzeugt.
