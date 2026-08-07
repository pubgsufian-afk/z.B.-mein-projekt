# Dienstplan-PDF mit frei wählbarem Zeitraum

Datum: 07.08.2026
Status: vom Nutzer inhaltlich bestätigt, noch nicht implementiert
Zweig: `fix/pdf-logo-contact-20260807`

## Ziel

Admin, Chef und Einsatzleiter sollen einen Dienstplan als PDF für einen frei wählbaren Zeitraum herunterladen können. Der Zeitraum wird mit zwei Datumsfeldern `Von` und `Bis` gewählt, zum Beispiel `01.08.2026` bis `31.08.2026`.

Die normale Wochenansicht des Dienstplans bleibt unverändert.

## Berechtigungen

- `owner`, `admin` und `manager` dürfen den Zeitraum auswählen und das Dienstplan-PDF herunterladen.
- `scheduler` / Dienstplan-Support darf weiterhin Dienstpläne bearbeiten, aber kein Dienstplan-PDF herunterladen.
- `employee` darf weiterhin kein Dienstplan-PDF herunterladen.
- Die Serverfunktion behält ihre bestehende Rollenprüfung bei; die Einschränkung wird nicht nur in der Oberfläche umgesetzt.

## Oberfläche

Im Verwaltungsbereich des Dienstplans bleibt der bestehende Button `Dienstplan als PDF` erhalten. Beim Antippen öffnet er einen kompakten PDF-Bereich direkt im Dienstplan-Werkzeugkasten.

Der Bereich enthält:

1. Feld `Von`
2. Feld `Bis`
3. Button `Dienstplan als PDF herunterladen`

Beim Öffnen werden die Datumsfelder zunächst mit der aktuell angezeigten Woche vorbelegt:

- `Von` = Montag der angezeigten Woche
- `Bis` = Sonntag der angezeigten Woche

Danach kann der Nutzer beide Werte frei ändern. Die Auswahl ist unabhängig von der sichtbaren Wochenansicht; für einen Monats-PDF muss die Kalenderansicht also nicht Woche für Woche umgeschaltet werden.

Auf dem iPhone stehen `Von`, `Bis` und der Download-Button untereinander, damit kein horizontaler Überlauf entsteht.

## Download-Verhalten

Beim Download sendet die Oberfläche genau die gewählten Werte an die bestehende Route `/api/schedule-pdf`:

```json
{
  "from": "2026-08-01",
  "to": "2026-08-31"
}
```

Die bestehende Serverfunktion unterstützt diesen Vertrag bereits und lädt alle Dienstplaneinträge innerhalb des gewählten Zeitraums.

Im PDF erscheinen ausschließlich freigegebene Dienste (`published`). Tage ohne freigegebenen Dienst werden nicht als leere Zeilen erzeugt. Lange Zeiträume werden automatisch über mehrere PDF-Seiten verteilt.

Der Dateiname bleibt nach dem vorhandenen Schema eindeutig, zum Beispiel:

`Habun-Dienstplan-2026-08-01-bis-2026-08-31.pdf`

## Validierung und Fehlerfälle

Vor dem Download prüft die Oberfläche:

- `Von` ist gesetzt.
- `Bis` ist gesetzt.
- `Bis` liegt nicht vor `Von`.

Bei ungültiger Auswahl wird kein Download gestartet und eine verständliche Meldung angezeigt.

Die Serverprüfung bleibt zusätzlich bestehen. Damit können ungültige oder manipulierte Anfragen nicht nur über die Oberfläche verhindert werden.

Wenn im Zeitraum keine freigegebenen Dienste vorhanden sind, zeigt die Oberfläche die bestehende Servermeldung an und lädt keine leere PDF herunter.

## Bestehende Funktionen, die unverändert bleiben

- Wochenwahl `Woche ab`
- `Vorherige`, `Aktuelle Woche`, `Nächste`
- `Vorwoche kopieren`
- Dienst erstellen und bearbeiten
- Freigabe des Wochenplans
- Mitarbeiteransicht des eigenen Dienstplans
- Dienstplan-Support ohne PDF-Recht
- bestehendes PDF-Layout mit Habun-Logo und Firmendaten

## Technische Änderungen

### Frontend

`frontend/src/App.jsx`

- zwei Zustände für PDF-Zeitraum ergänzen
- PDF-Auswahlbereich für Management-Rollen ergänzen
- bestehenden `downloadSchedulePdf()` so ändern, dass `pdfFrom` und `pdfTo` statt immer `week` bis `week + 6 Tage` gesendet werden
- clientseitige Datumsvalidierung ergänzen
- beim Öffnen der PDF-Auswahl die aktuell sichtbare Woche als Standard übernehmen

### Backend

`netlify/functions/schedule-pdf-fixed.mts`

Keine grundlegende neue API erforderlich. Die Route akzeptiert bereits `from` und `to`, validiert ISO-Daten, prüft die Reihenfolge, lädt genau diesen Zeitraum und gibt nur freigegebene Dienste aus.

Nur wenn die Implementierung einen konkreten Backend-Randfall zeigt, wird dort minimal nachgebessert.

### Tests

Die vorhandenen Tests werden erweitert um:

- PDF-Zeitraum ist nur für `owner`, `admin`, `manager` sichtbar
- `scheduler` sieht weiterhin keinen PDF-Download
- `employee` sieht weiterhin keinen PDF-Download
- Von/Bis werden korrekt an `/api/schedule-pdf` gesendet
- Monatsbeispiel `01.08.2026` bis `31.08.2026`
- `Bis < Von` verhindert den Download
- Desktop-, iPhone- und Android-Browserlauf bleibt grün
- bestehender Wochen-PDF-Fall bleibt als Standardfall funktionsfähig

## Erfolgskriterien

Die Funktion ist fertig, wenn:

1. Ein Admin kann einen beliebigen gültigen Von-Bis-Zeitraum wählen.
2. Die heruntergeladene PDF enthält nur freigegebene Dienste in diesem Zeitraum.
3. Leere Tage werden nicht künstlich in die PDF aufgenommen.
4. Mitarbeiter und Dienstplan-Support erhalten kein PDF-Recht.
5. Die Wochenansicht wird durch die neue Auswahl nicht verändert.
6. PDF-Download funktioniert auf Desktop, iPhone und Android.
7. Alle vorhandenen Portalprüfungen und der vollständige Browserlauf bleiben erfolgreich.
8. Es erfolgt keine Veröffentlichung ohne erneute ausdrückliche Freigabe des Nutzers.
