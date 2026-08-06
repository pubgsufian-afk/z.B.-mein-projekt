# Employee Kiosk and Mobile Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normale Mitarbeiter dürfen ausschließlich ein- und ausstempeln sowie Pausen beginnen und beenden; Logo, Farben und mobile/PWA-Darstellung bleiben markentreu und vollständig bedienbar.

**Architecture:** Die Rollenbegrenzung wird doppelt umgesetzt: in React werden Mitarbeiter direkt in einen reduzierten Stempeluhr-Modus geleitet, und die Netlify-Funktionen sperren nicht benötigte Datenendpunkte serverseitig. Mobile Darstellung nutzt iOS/Android-Safe-Area-Abstände und zeigt das unveränderte Original-Logo deutlich sichtbar.

**Tech Stack:** React 19, CSS, Netlify Identity, Netlify Functions, Netlify Database, Playwright.

## Global Constraints

- Keine Änderung der bestehenden Schwarz-Gold-Farben.
- Keine Veränderung der Bilddatei oder Farben des Firmenlogos.
- Kein Merge und keine Veröffentlichung ohne spätere ausdrückliche Freigabe.
- Mitarbeiter sehen nur Digitaluhr, Status, Arbeitsbeginn, Pausenbeginn, Pausenende, Arbeitsende und Abmelden.
- Serverzugriffe auf Dienstplan, Stundenverlauf, Korrekturen, Berichte, Mitarbeiter, Einsatzorte und Einstellungen sind für Mitarbeiter gesperrt.

---

### Task 1: Rollen- und Sichtbarkeitstests

**Files:**
- Modify: `scripts/unified-portal-test.mjs`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Create: `scripts/employee-access-policy-test.mjs`
- Modify: `package.json`

- [ ] Test festlegen, dass die Mitarbeiter-Navigation nur `Zeiterfassung` enthält.
- [ ] Test festlegen, dass Mitarbeiter keine Gesamtstunden, Buchungsliste, Dienstpläne, Korrekturen, PDF oder Excel sehen.
- [ ] Test festlegen, dass geschützte Serverbereiche Mitarbeiter mit HTTP 403 ablehnen.
- [ ] Tests ausführen und das erwartete Fehlschlagen bestätigen.

### Task 2: Mitarbeiter-Kioskmodus

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`

- [ ] Mitarbeiter direkt auf `attendance` starten lassen.
- [ ] Mobile und Desktop-Navigation für Mitarbeiter auf Abmelden reduzieren.
- [ ] In der Zeiterfassung für Mitarbeiter nur Uhr, Arbeitsstatus und die vier erlaubten Aktionen anzeigen.
- [ ] Heutigen Dienst, Buchungsliste, Live-Übersicht, Schnellzugriff und sonstige Portalbereiche ausblenden.
- [ ] Rollen- und Browsertests ausführen.

### Task 3: Serverseitige Rechtebegrenzung

**Files:**
- Modify: `netlify/functions/attendance.mts`
- Modify: `netlify/functions/attendance-maintenance.mts`
- Modify: `netlify/functions/schedule-v2.mts`
- Verify: `netlify/functions/unified-reports.mts`
- Verify: `netlify/functions/reports-v2.mts`
- Verify: `netlify/functions/worksite-v2.mts`

- [ ] Mitarbeiterzugriff auf `history` und `live` sperren; `state` und Stempelaktionen bleiben erlaubt.
- [ ] Korrektur- und Aufbewahrungsfunktion vollständig auf Managementrollen begrenzen.
- [ ] Dienstplan-Endpunkt für Mitarbeiter sperren, ohne die interne Ermittlung des aktuellen Dienstes in der Attendance-Funktion zu beschädigen.
- [ ] PDF, Excel, Mitarbeiter, Einsatzorte und Einstellungen serverseitig verifizieren.
- [ ] API-Vertragstests ausführen.

### Task 4: Logo und mobile/PWA-Darstellung

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/styles.css`
- Modify: `public/index.html`
- Verify: `public/manifest.webmanifest`

- [ ] Original-Logo im Kopfbereich sichtbar und größer darstellen, ohne die Datei oder Farben zu verändern.
- [ ] `viewport-fit=cover` setzen.
- [ ] Safe-Area-Abstände für iPhone oben und unten sowie installierte PWA ergänzen.
- [ ] Seitenleiste und Inhalte bei kleiner Höhe scrollbar und vollständig erreichbar halten.
- [ ] Horizontales Überlaufen auf 320 px, 375 px, 390 px, iPhone und Android verhindern.

### Task 5: Vollständige Prüfung ohne Veröffentlichung

**Files:**
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Update: PR #12 Prüfprotokoll

- [ ] Quelltests, Datenbanktests und Build ausführen.
- [ ] Playwright für Admin und Mitarbeiter auf Desktop, iPhone und Android ausführen.
- [ ] Mitarbeiteraktionen Arbeitsbeginn → Pause → Pause beenden → Arbeitsende prüfen.
- [ ] Admin-Bereiche Dienstplan, Mitarbeiter, Einsatzorte, Einstellungen, PDF und Excel prüfen.
- [ ] Logo-Sichtbarkeit und Safe-Area-Abstände per Screenshots prüfen.
- [ ] PR als Entwurf offen lassen und ausdrücklich nicht veröffentlichen.
