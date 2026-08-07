# Dienstplan-Assistent – Design

## Ziel

Ein eigener, eingeschränkter Portal-Zugang für ChatGPT soll Dienstpläne aus strukturierten Angaben sicher veröffentlichen können, ohne direkte Datenbankbearbeitung und ohne allgemeine Admin-Rechte.

## Verhalten

- ChatGPT erhält keinen normalen Mitarbeiter- oder Admin-Login mit dauerhaft gespeichertem Passwort.
- Stattdessen gibt es eine serverseitig geschützte Integration namens „Dienstplan-Assistent“ mit Scheduler-Berechtigungen ausschließlich für Dienstplanung.
- Der Zugang darf aktive registrierte Mitarbeiter für die Dienstplanung suchen, Dienste erstellen und eindeutige Dienste sofort veröffentlichen.
- Der Zugang darf keine Mitarbeiterkonten anlegen/löschen, keine Rollen verändern, keine Zeiterfassung bearbeiten und keine Portal-Einstellungen ändern.
- Jeder durch die Integration veröffentlichte Dienst wird im vorhandenen Dienstplan-Audit als Quelle `chatgpt` und Akteur `dienstplan-assistent` protokolliert.
- Exakte Duplikate werden nicht doppelt angelegt.
- Ist ein Mitarbeitername unbekannt oder nicht eindeutig, wird nur dieser Eintrag abgelehnt; andere eindeutige Einträge dürfen veröffentlicht werden.
- Ohne expliziten Einsatzort wird der beim Mitarbeiter gespeicherte Einsatzort verwendet; falls dort keiner hinterlegt ist, wird `Abbott` verwendet.
- Wenn keine Pause angegeben ist, werden 0 Minuten verwendet.

## Schnittstelle

Neue Netlify Function: `/api/schedule-assistant`.

Authentifizierung über `Authorization: Bearer <token>`. Der Token liegt ausschließlich als geheime Netlify-Umgebungsvariable `SCHEDULE_ASSISTANT_TOKEN` vor.

Unterstützte Aktionen:

1. `resolve-employees` – Namen gegen aktive Portal-Mitarbeiter auflösen.
2. `publish-shifts` – mehrere Dienste validieren, Mitarbeiter eindeutig auflösen und sofort veröffentlichen.

Die Schnittstelle akzeptiert strukturierte Daten. Das Parsen einer WhatsApp-Nachricht bleibt Aufgabe von ChatGPT; die Portal-Schnittstelle entscheidet ausschließlich über sichere Zuordnung und Veröffentlichung.

## Sicherheit

- Keine CORS-Freigabe.
- Nur POST-Anfragen.
- Bearer-Token wird mit einem zeitkonstanten Vergleich geprüft.
- Fehlende oder falsche Authentifizierung liefert 401.
- Mitarbeiter werden aus dem aktiven `portal-access`-Verzeichnis geladen, nicht frei über eine übermittelte Benutzer-ID ausgewählt.
- Alle Schichten laufen über das bestehende Dienstplan-Repository und dessen Duplikat-/Audit-Logik.
- Keine generische SQL- oder Admin-Funktion wird angeboten.
- Die Integration kann durch Entfernen oder Rotieren der Netlify-Umgebungsvariable sofort gesperrt werden.

## Fehlerverhalten

Die Antwort enthält pro Eintrag `published`, `duplicate`, `not_found`, `ambiguous` oder `invalid`. Dadurch kann ChatGPT dem Nutzer nur die problematischen Personen melden, ohne bereits gültige Dienste zurückzunehmen.

Zeitüberschneidungen werden wie im bestehenden Portal nicht automatisch blockiert, aber als Warnungen zurückgegeben.

## Veröffentlichung

Die Implementierung erfolgt zunächst auf dem separaten GitHub-Branch `feature/dienstplan-assistent`. Keine Produktionsveröffentlichung ohne gesonderte Freigabe nach Prüfung.