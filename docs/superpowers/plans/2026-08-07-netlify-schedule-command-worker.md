# Netlify Schedule Command Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen dauerhaften ChatGPT→Netlify→Dienstplan-Assistent-Zugang bauen, der aktive Mitarbeiter synchronisiert und eindeutige Dienste ohne manuelle Portal-Schritte veröffentlicht.

**Architecture:** ChatGPT schreibt einen geheimen Command in eine Netlify-Produktionsvariable und aktualisiert danach nur eine harmlose Trigger-Datei auf `main`, damit Netlify mit dem neuen Secret-Wert deployed. Eine minütliche Scheduled Function validiert und idempotent verarbeitet den Command, indem sie intern den bestehenden `schedule-assistant` aufruft. Ergebnisprüfung erfolgt lesend über Neon.

**Tech Stack:** Netlify Functions, Netlify Scheduled Functions, Netlify Blobs, bestehender Schedule Assistant, GitHub Auto-Deploy, Neon Postgres.

## Global Constraints

- Kein direkter ChatGPT-Schreibzugriff auf Neon.
- Keine Dienstplandaten oder Secrets im GitHub-Repository.
- Keine neue öffentliche Schreib-API und keine CORS-Freigabe.
- Nur Aktionen `sync-directory` und `publish-shifts`.
- Commands älter als 30 Minuten werden verworfen.
- Wiederholte Command-IDs werden nicht erneut ausgeführt.
- Unbekannte oder mehrdeutige Mitarbeiternamen werden nicht geraten.
- Bestehende Portal-, Rollen-, Standort-, Zeiterfassungs-, PDF- und Exportfunktionen bleiben unverändert.

---

### Task 1: Command-Validierung

**Files:**
- Create: `scripts/schedule-command-worker-test.mjs`
- Create: `netlify/functions/_shared/schedule-command-worker-core.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseScheduleCommand(raw, now)`.
- Command: `{ version: 1, commandId: string, createdAt: string, action: 'sync-directory' | 'publish-shifts', shifts?: unknown[] }`.

- [ ] **Step 1: Write the failing test**
  - Test gültige `sync-directory`- und `publish-shifts`-Commands.
  - Test leere ID, falsche Version, unbekannte Aktion, ungültiges Datum, älter als 30 Minuten und fehlende Shift-Liste bei `publish-shifts`.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `node --experimental-strip-types scripts/schedule-command-worker-test.mjs`
  - Expected: FAIL, weil der Core noch fehlt.
- [ ] **Step 3: Write minimal implementation**
  - JSON parsen, Felder prüfen, Alter prüfen und typisierten Command zurückgeben.
- [ ] **Step 4: Run test to verify it passes**
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `feat: validate schedule worker commands`

### Task 2: Directory-Sync im bestehenden Assistenten

**Files:**
- Modify: `scripts/schedule-assistant-source-test.mjs`
- Modify: `netlify/functions/schedule-assistant.mts`

**Interfaces:**
- Neue geschützte Aktion: `sync-directory`.
- Response: `{ integration: 'Dienstplan-Assistent', role: 'scheduler', employeeCount: number }`.

- [ ] **Step 1: Write the failing test**
  - Source-Test verlangt `action === 'sync-directory'` und `employeeCount`.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `node scripts/schedule-assistant-source-test.mjs`
  - Expected: FAIL.
- [ ] **Step 3: Write minimal implementation**
  - Nach `activePortalEmployees()` nur die Anzahl zurückgeben.
- [ ] **Step 4: Run test to verify it passes**
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `feat: expose protected directory sync action`

### Task 3: Scheduled Worker

**Files:**
- Create: `scripts/schedule-command-worker-source-test.mjs`
- Create: `netlify/functions/schedule-command-worker.mts`
- Modify: `package.json`

**Interfaces:**
- Secret input: `Netlify.env.get('SCHEDULE_ASSISTANT_COMMAND')`.
- Auth input: existing `SCHEDULE_ASSISTANT_TOKEN`.
- Idempotency store: Netlify Blob `schedule-command-worker`, key `processed/<commandId>`.
- Schedule: `* * * * *` UTC.

- [ ] **Step 1: Write the failing test**
  - Verlangt Secret-Lesen über `Netlify.env`, starken Blob-Store, `processed/`, internen `scheduleAssistant`-Aufruf, `requestId: commandId`, Minutenplan und keine CORS-Header.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `node scripts/schedule-command-worker-source-test.mjs`
  - Expected: FAIL.
- [ ] **Step 3: Write minimal implementation**
  - Leeres Secret: no-op.
  - Ungültiger Command: loggen, nicht ausführen.
  - Bereits verarbeitet: no-op.
  - Neuer Command: internen POST-Request an `scheduleAssistant` bauen, Response auswerten, minimales Ergebnis in Blob schreiben.
- [ ] **Step 4: Run test to verify it passes**
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `feat: process schedule commands on Netlify`

### Task 4: Trigger-Datei und Gesamtprüfung

**Files:**
- Create: `ops/schedule-command-trigger.txt`
- Modify: `package.json` falls Tests noch nicht in `verify:unified` hängen.

**Interfaces:**
- Datei enthält ausschließlich eine zufällige Command-ID oder `idle`.

- [ ] **Step 1: Integrate tests**
  - `verify:unified` führt Worker-Core- und Worker-Source-Tests aus.
- [ ] **Step 2: Full CI**
  - PR gegen `main` öffnen.
  - Erwartet: `npm run verify`, `npm run build`, `npm run test:e2e` grün.
- [ ] **Step 3: Merge and production verification**
  - Nur nach grüner CI mergen.
  - Netlify-Deploy muss `ready` sein und `schedule-command-worker` sowie `schedule-assistant` enthalten.

### Task 5: End-to-End-Zugang aktivieren

**Files:**
- Keine neuen Source-Dateien.

**Interfaces:**
- Netlify Secret: `SCHEDULE_ASSISTANT_COMMAND` mit Scopes `builds` und `functions`, Production, Secret.

- [ ] **Step 1: Directory command setzen**
  - Command-ID generieren, `sync-directory` als Secret setzen.
- [ ] **Step 2: Trigger deploy**
  - `ops/schedule-command-trigger.txt` auf `main` auf die Command-ID aktualisieren.
- [ ] **Step 3: Wait and verify**
  - Produktionsdeploy abwarten; danach bis zu wenige Minuten `schedule_employees` lesend in Neon prüfen.
- [ ] **Step 4: Saturday shift command**
  - Für eindeutig gefundenen registrierten Mitarbeiter den freigegebenen Samstagsdienst per `publish-shifts` setzen und erneut triggern.
- [ ] **Step 5: Final verification**
  - Shift in Neon über `source='chatgpt'` und Command-ID prüfen; keine doppelten Einträge; GitHub enthält keine Dienstplandaten.
