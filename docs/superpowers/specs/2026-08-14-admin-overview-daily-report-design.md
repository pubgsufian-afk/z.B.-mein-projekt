# Admin-Übersicht und Tagesbericht – Design

Datum: 14. August 2026  
Status: Visuelles Konzept vom Nutzer freigegeben

## Ziel

Die bestehende Seite `Übersicht` wird aufgeräumt und als professionelles Admin-Dashboard gestaltet. Die bestehenden Bereiche `Zeiten` und `Berichte` bleiben im Portal erhalten; nur ihre bisherigen Schnellzugriffs-Kacheln werden aus der Übersicht entfernt.

## Rollen

- `owner` und `admin` gelten für diese Funktion als Administration.
- `Einsatz-Zentrale` ist ausschließlich für `owner` und `admin` sichtbar.
- `Tagesbericht` ist ausschließlich für `owner` und `admin` sichtbar.
- `manager` und `employee` dürfen weder die Einsatz-Zentrale noch Tagesberichte sehen oder über die API lesen/schreiben.
- Die Zugriffskontrolle muss sowohl im Frontend als auch serverseitig erfolgen.

## Übersicht

Die bisherige Schnellzugriffs-Kachel `Meine Zeiten – Buchungen und Stunden prüfen` wird nur aus der Übersicht entfernt. Die bestehende Seite `Zeiten` bleibt unverändert erreichbar.

Die bisherige Schnellzugriffs-Kachel `Berichte – PDF und Excel erstellen` wird nur aus der Übersicht entfernt. Der bestehende Berichte-Bereich bleibt unverändert erreichbar.

Die Übersicht erhält stattdessen folgende Reihenfolge:

1. Einsatz-Zentrale, nur Administration
2. Tagesbericht, nur Administration
3. Digitale Zeiterfassung
4. Dienstplan
5. Heute mit den geplanten Diensten

Das bestehende dunkle Habun-Design, das Original-Logo und die Portal-Navigation bleiben erhalten. Die neue Oberfläche orientiert sich am freigegebenen mobilen Mockup mit dunklen Karten, goldenen Akzenten, klarer Typografie und großen Touch-Zielen.

## Einsatz-Zentrale

Die Einsatz-Zentrale zeigt vier kompakte, zunächst geschlossene Statuszeilen:

- `Im Dienst · N`
- `In Pause · N`
- `Noch nicht gestartet · N`
- `Dienst beendet · N`

Beim Antippen einer Zeile klappt ausschließlich diese Gruppe auf und zeigt die Namen der zugehörigen Mitarbeiter. Ein erneutes Antippen schließt sie wieder.

### Datenbasis

Die Einsatz-Zentrale verwendet ausschließlich vorhandene Daten:

- heutige veröffentlichte Schichten aus `/api/schedule-v2?resource=entries`
- heutige Live-Zeiterfassungsdaten aus `/api/attendance?resource=live`

Es wird keine neue Standortverfolgung eingeführt.

### Statuszuordnung

Für jeden heute eingeplanten Mitarbeiter wird die aktuellste Zeiterfassungsaktion des Tages ausgewertet.

- letzte Aktion `clock-in` oder `break-end` → `Im Dienst`
- letzte Aktion `break-start` → `In Pause`
- letzte Aktion `clock-out` → `Dienst beendet`
- keine heutige Zeiterfassungsaktion → `Noch nicht gestartet`

Ein Mitarbeiter erscheint immer nur in genau einer Gruppe. Doppelte Schichten desselben Mitarbeiters dürfen nicht zu doppelten Namen in der Einsatz-Zentrale führen.

## Tagesbericht

Die Übersicht erhält eine Admin-Karte `Tagesbericht` mit zwei Aktionen:

- `Bericht schreiben`
- `Berichte öffnen`

Der Bericht wird direkt innerhalb der Übersicht in einem Dialog/Panel geöffnet; es ist kein zusätzlicher Eintrag im Seitenmenü notwendig.

### Neuer Bericht

Ein Bericht besteht ausschließlich aus:

- Berichtstext
- Ersteller-ID, serverseitig aus dem angemeldeten Konto
- Erstellername, serverseitig aus dem angemeldeten Konto bzw. Portalprofil
- Erstellungsdatum und Uhrzeit, serverseitig gesetzt

Der Admin trägt nur den Berichtstext selbst ein. Name, Datum und Uhrzeit sind nicht editierbar.

### Textlimit

- maximal 1.000 Wörter pro Bericht
- sichtbarer Wortzähler während der Eingabe, z. B. `327 / 1.000 Wörter`
- Speichern ist oberhalb von 1.000 Wörtern nicht möglich
- dieselbe Begrenzung wird serverseitig erneut geprüft

### Speicherverbrauch

Die Funktion bleibt bewusst sparsam:

- nur Text und notwendige Metadaten
- keine Fotos
- keine KI
- kein Autosave bei jedem Tastendruck
- genau ein Schreibvorgang erst beim Tippen auf `Bericht speichern`
- Berichtsliste wird bei Bedarf geladen, nicht dauerhaft im Hintergrund

### Gespeicherte Berichte

`Berichte öffnen` zeigt die gespeicherten Tagesberichte in umgekehrt chronologischer Reihenfolge. Pro Eintrag werden angezeigt:

- Erstellername
- Datum
- Uhrzeit
- Berichtstext

Für Version 1 gibt es kein Bearbeiten und kein Löschen. Damit bleibt nachvollziehbar, wer wann welchen Bericht gespeichert hat.

## Backend und Speicherung

Es wird ein neuer Netlify-Endpunkt `/api/daily-reports` angelegt.

Unterstützte Aktionen:

- `GET` → gespeicherte Berichte lesen
- `POST` → neuen Bericht speichern

Beide Methoden sind ausschließlich für `owner` und `admin` erlaubt. Der Server übernimmt die Autor-Metadaten aus der authentifizierten Sitzung und vertraut dafür keinen Werten aus dem Browser.

Die Speicherung verwendet die im Projekt bereits vorhandene Netlify-Infrastruktur. Für diese kleine Textfunktion wird Netlify Blobs mit einem eigenen Store `portal-daily-reports` verwendet, damit keine unnötige zusätzliche Datenbankstruktur nötig ist. Schlüssel enthalten einen serverseitigen Zeitstempel und eine UUID, damit Berichte chronologisch und eindeutig gespeichert werden können.

## Fehlerverhalten

- Nicht angemeldet → 401
- Keine Adminrolle → 403
- leerer Bericht → 400
- mehr als 1.000 Wörter → 400
- Speicherfehler → verständliche Fehlermeldung, eingegebener Text bleibt im Dialog erhalten
- fehlerhafte Einsatz-Zentrale-Daten dürfen den restlichen Überblick nicht unbenutzbar machen

## Responsive Design

Mobile ist die Hauptansicht. Auf schmalen Bildschirmen stehen alle Hauptkarten untereinander. Die vier Statuszeilen erhalten ausreichend große Touch-Flächen. Auf breiteren Ansichten darf der Inhalt breiter werden, bleibt aber optisch an der bestehenden Portalstruktur ausgerichtet.

## Bestehende Funktionen, die nicht verändert werden

- Seite `Zeiten`
- bestehender PDF-/Excel-Berichte-Bereich
- Zeiterfassungslogik
- Dienstplanlogik
- Mitarbeiter-Navigation
- Original-Logo
- bestehende Rollen außerhalb der neuen Admin-only-Funktionen

## Technische Hauptdateien

Voraussichtlich betroffen:

- `frontend/src/App.jsx` – Übersicht, Einsatz-Zentrale, Tagesbericht-Dialoge und Datenabrufe
- `frontend/src/styles.css` – neue Dashboard-, Akkordeon- und Tagesbericht-Stile
- `netlify/functions/daily-reports.mts` – Admin-only API für Lesen und Speichern
- passende Tests unter `tests/` bzw. `tests/e2e/`

## Abnahmekriterien

Die Umsetzung gilt als fertig, wenn:

1. `Meine Zeiten` und die alte `Berichte`-Kachel nur aus der Übersicht verschwunden sind.
2. Die übrigen bestehenden Portalbereiche weiter funktionieren.
3. Nur Administration die Einsatz-Zentrale und Tagesberichte sehen kann.
4. Die vier Statuszahlen korrekt aus Tagesdienstplan und Zeiterfassung berechnet werden.
5. Namen erst nach Antippen einer Statuszeile sichtbar werden.
6. Ein Admin einen Bericht bis 1.000 Wörter speichern kann.
7. Autor, Datum und Uhrzeit automatisch und serverseitig gespeichert werden.
8. Normale Mitarbeiter und Einsatzleiter die Tagesberichte weder im UI noch über die API lesen oder schreiben können.
9. Das mobile Ergebnis dem freigegebenen Mockup visuell eng entspricht.
10. Build und automatisierte Tests erfolgreich durchlaufen.
