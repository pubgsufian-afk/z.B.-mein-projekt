# Dienstplan-Assistent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen eingeschränkten Portal-Integrationszugang bereitstellen, der aktive Mitarbeiter eindeutig auflöst und eindeutige Dienste sofort veröffentlicht, ohne direkten Datenbankzugriff durch den Chat.

**Architecture:** Eine neue Netlify Function `/api/schedule-assistant` authentifiziert sich ausschließlich über einen geheimen Bearer-Token aus Netlify-Umgebungsvariablen. Die Funktion liest aktive Mitarbeiter aus `portal-access`, löst Namen strikt-normalisiert auf und schreibt veröffentlichte Schichten über das vorhandene `schedule-neon-repository`; jede Aktion wird als `dienstplan-assistent` auditiert.

**Tech Stack:** TypeScript/MTS, Netlify Functions, Netlify Blobs, Netlify Database/Postgres, Node.js Assertions.

## Global Constraints

- Keine direkten SQL-Endpunkte oder generischen Admin-Rechte.
- Keine dauerhaften Passwörter im Quellcode oder Chat-Speicher.
- Nur aktive registrierte Portal-Mitarbeiter dürfen zugeordnet werden.
- Unbekannte oder mehrdeutige Namen werden nicht automatisch geraten.
- Exakte Duplikate werden nicht doppelt angelegt.
- Eindeutige Einträge werden sofort als `published` gespeichert.
- Keine Produktionsveröffentlichung ohne gesonderte Freigabe nach Prüfung.

---

### Task 1: Reine Auflösungs- und Validierungslogik

**Files:**
- Create: `netlify/functions/_shared/schedule-assistant-core.mts`
- Create: `scripts/schedule-assistant-core-test.mjs`

**Interfaces:**
- Produces: `normalizeAssistantName`, `resolveAssistantEmployee`, `validateAssistantShiftInput`, `defaultAssistantLocation`.

- [ ] **Step 1:** Failing tests für Namensnormalisierung, eindeutige/mehrdeutige/nicht gefundene Mitarbeiter und Zeitvalidierung schreiben.
- [ ] **Step 2:** Tests ausführen und erwartetes Fehlschlagen wegen fehlendem Modul bestätigen.
- [ ] **Step 3:** Minimale reine Hilfsfunktionen implementieren.
- [ ] **Step 4:** Tests erneut ausführen und PASS bestätigen.

### Task 2: Geschützter Portal-Endpunkt

**Files:**
- Create: `netlify/functions/schedule-assistant.mts`
- Create: `scripts/schedule-assistant-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `listActiveScheduleEmployees`, `findExactScheduleDuplicate`, `listScheduleOverlaps`, `upsertScheduleShift`, `writeScheduleAudit` from `schedule-neon-repository.mts`.
- Produces: `POST /api/schedule-assistant` actions `resolve-employees` und `publish-shifts`.

- [ ] **Step 1:** Source-contract test schreiben, der Bearer-Auth, `SCHEDULE_ASSISTANT_TOKEN`, fehlendes CORS, `portal-access`, Audit-Akteur und beide Aktionen verlangt.
- [ ] **Step 2:** Test ausführen und erwartetes Fehlschlagen bestätigen.
- [ ] **Step 3:** Netlify Function implementieren: Token prüfen, aktive Mitarbeiter aus `portal-access` laden und synchronisieren, Namen auflösen, pro Schicht validieren, Duplikate erkennen, Überschneidungen als Warnung liefern, sofort veröffentlichen und Audit schreiben.
- [ ] **Step 4:** Test erneut ausführen und PASS bestätigen.
- [ ] **Step 5:** `verify:unified` um beide neuen Tests erweitern.

### Task 3: Integrationsprüfung vor Produktion

**Files:**
- No production code changes beyond Tasks 1–2.

- [ ] **Step 1:** Gesamten Branch-Diff gegen `main` prüfen.
- [ ] **Step 2:** Sicherstellen, dass kein Secret im Repository liegt und keine Admin-/Attendance-Funktion importiert wird.
- [ ] **Step 3:** Branch-Prüfung/Build durchführen, soweit die verbundene Umgebung dies erlaubt.
- [ ] **Step 4:** Erst danach Freigabe für Produktions-Merge/Deploy einholen.
- [ ] **Step 5:** Nach Produktionsfreigabe einen starken zufälligen `SCHEDULE_ASSISTANT_TOKEN` als geheime Netlify-Umgebungsvariable setzen; Token nicht im Chat ausgeben.
