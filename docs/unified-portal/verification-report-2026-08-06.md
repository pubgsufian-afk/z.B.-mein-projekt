# Prüfbericht – Einheitliches Habun-Mitarbeiterportal

Stand: 06.08.2026
Arbeitszweig: `fix/unified-portal-mobile-settings`
Produktionszweig: unverändert

## Ergebnis

Der geschützte Arbeitsstand wurde erfolgreich gebaut und automatisiert geprüft. Er wurde weder in `main` zusammengeführt noch auf der Produktionsseite veröffentlicht.

## Geprüfte Anforderungen

- eine einzige React-Portaloberfläche
- kein sichtbarer Knopf „Neue Zeiterfassung“
- kein zweites Zeiterfassungsfenster und kein Dialog-Portal
- unveränderte Schwarz-Gold-Farbpalette
- vorhandenes Habun-Logo bleibt eingebunden
- rollenabhängige Navigation
- moderne Digitaluhr mit Sekunden
- Arbeitsbeginn, Pause beginnen, Pause beenden und Arbeitsende
- Standortabfrage nur bei Arbeitsbeginn und Arbeitsende
- mobile Dienstplanansicht mit Tageskarten
- einfacher mobiler Diensteditor
- Dienstplan nach Mitarbeiternamen statt sichtbarer technischer ID
- eigener Bereich „Meine Zeiten“
- Einsatzorte und Korrekturen als getrennte Bereiche
- Einstellungen bleiben als normaler Portalbereich geöffnet
- Firmenname, Telefonnummer, E-Mail und Logo werden einmal gespeichert
- PDF-Vorschau und PDF-Download
- Excel-Download
- PDF- und Excel-Branding aus den gespeicherten Firmendaten
- Mitarbeiter sehen keine Administrationsbereiche
- keine sichtbare Mitarbeiter-ID oder Personalnummer
- keine horizontale Seitenverschiebung auf den geprüften Mobilgrößen

## Automatisierte Quell-, API- und Buildprüfungen

Erfolgreich:

- Admin-Stundenzettel-Test
- Dienstplan-Mehrfachstellen: 5 Regeln
- Attendance Domain: 17 Prüfungen
- Attendance API Contract: 24 Prüfungen
- Attendance Handler: 16 Prüfungen
- Attendance Repository: 13 Prüfungen
- Schedule V2: 6 Prüfungen
- Schedule Assistant: 8 Prüfungen
- Worksite V2: 6 Prüfungen
- Attendance Corrections: 9 Prüfungen
- Attendance Retention: 6 Prüfungen
- Reports V2: 17 Prüfungen
- Unified-Portal-Quelltest
- Pausenablauf-Test
- Firmeneinstellungen-Test
- PDF- und Excel-Branding-Test
- Produktions-Build des neuen Frontends

Build-Ausgabe:

- `habun-portal.js`: 253,7 KB
- `habun-portal.css`: 21,8 KB

## Browserprüfungen

Alle 18 Browserabläufe bestanden:

- 6 Abläufe auf Desktop Chromium
- 6 Abläufe auf iPhone 15 Chromium
- 6 Abläufe auf Pixel 7 Chromium

Geprüfte Abläufe:

1. öffentliche Registrierung ohne Mitarbeiter-ID
2. eine Portaloberfläche und stabile Einstellungen
3. Digitaluhr mit Arbeits- und Pausenablauf
4. einfache mobile Dienstplanerstellung
5. PDF-Vorschau, PDF-Download und Excel-Download
6. eingeschränkte Mitarbeiterrechte

GitHub-Actions-Lauf: `31091477496`
Ergebnis: erfolgreich

## Neon-Testdatenbank

Verwendeter Testzweig:

- Name: `attendance-v2-dev`
- ID: `br-red-night-affgml0t`

Die Pausenaktionen wurden nur dort aktiviert und geprüft. Akzeptiert wurden:

- `clock-in`
- `break-start`
- `break-end`
- `clock-out`

Ein ungültiger Aktionswert wurde weiterhin von der Datenbank blockiert. Die angelegten Testdatensätze wurden anschließend entfernt.

## Noch nicht ausgeführt

- keine Zusammenführung nach `main`
- keine Veröffentlichung auf der Live-Seite
- keine Änderung der Produktionsdatenbank für Pausenaktionen
- kein Test mit den echten persönlichen Benutzerkonten
- keine Freigabe durch den Nutzer anhand einer veröffentlichten Vorschau

Vor einer späteren Veröffentlichung müssen die Produktionsmigration und der Produktionsdeploy kontrolliert und ausdrücklich freigegeben werden.
