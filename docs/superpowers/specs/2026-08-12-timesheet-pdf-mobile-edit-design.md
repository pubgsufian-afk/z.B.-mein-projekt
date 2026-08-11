# Stundenzettel: früheres PDF-Design und einfache mobile Bearbeitung

Datum: 2026-08-12

## Ziel

Der neue, dienstplanbasierte Stundenzettel bleibt technisch vollständig vom Stempelprotokoll getrennt. Gleichzeitig soll der PDF-Stundenzettel wieder das frühere Habun-Layout erhalten, das der Nutzer als Vorlage bereitgestellt hat. Zusätzlich muss die Bearbeitung auf dem iPhone ohne horizontales Suchen möglich sein.

Diese Änderung holt **nicht** die frühere gemischte Datenlogik zurück. Sie übernimmt nur das gewünschte Aussehen des alten PDFs und verbessert die Bedienung des neuen Stundenzettels.

## Verbindliche Datenquelle

- Der Stundenzettel verwendet ausschließlich die eigenständigen `timesheet_entries`.
- Offene Monate werden weiterhin aus veröffentlichten Dienstplanschichten synchronisiert.
- Stempel-/Attendance-Daten verändern den Stundenzettel niemals automatisch.
- Das Stempelprotokoll und dessen Vergleich/Export bleiben separat.
- Die bestehende Monats- und Korrekturfristlogik bleibt unverändert.

## PDF-Design

Das PDF orientiert sich visuell an der vom Nutzer bereitgestellten früheren Habun-Stundenzettel-Vorlage.

### Kopfbereich

Oben steht:

- Titel: **Stundenzettel**
- darunter der Monat bzw. gewählte Zeitraum
- **Arbeitnehmer: <Mitarbeitername>**

Das bisherige Wort „Arbeitszeitenbericht“ wird nicht verwendet.

### Tabelle

Die Tabelle verwendet das frühere Habun-Erscheinungsbild mit goldener Kopfzeile und klaren schwarzen/grauen Linien.

Spalten:

1. Datum
2. Startzeit
3. Endzeit
4. Pause
5. Dauer
6. Status
7. Tätigkeit / Einsatzort

Für den ausgewählten Zeitraum werden auch Kalendertage ohne Eintrag als leere Zeilen angezeigt, wie in der früheren Vorlage. Dadurch ist der Stundenzettel als vollständige Zeitraum-/Monatsübersicht lesbar.

### Status

Da Stempelzeiten nicht mehr Teil des Stundenzettels sind, verwendet die Statusspalte keine Attendance-Angabe „Erfasst“.

- automatisch aus Dienstplan synchronisierter Eintrag: **Dienstplan**
- bewusst manuell angelegter oder manuell geänderter Stundenzettel-Eintrag: **Manuell**

### Gesamtdauer

Unter der Tabelle erscheint wieder ein hervorgehobener goldener Bereich:

- **Gesamtdauer**
- Summe der Nettoarbeitszeit für diesen Mitarbeiter im gewählten Zeitraum

Die Pause wird vor der Summierung abgezogen.

### Anmerkungen

Unterhalb der Gesamtdauer bleibt ein sichtbares Feld **Anmerkungen** wie in der früheren Vorlage. In dieser Änderung ist es ein druckbares leeres Feld; es wird keine neue Freitext-Datenbankfunktion eingeführt.

### Logo und Firmenangaben

- Das zentrale, bereits in den Einstellungen verwaltete Habun-Firmenlogo wird verwendet.
- Das Logo darf nicht in einem störenden schwarzen Kasten erscheinen.
- Ein großes, dezentes und transparentes Habun-Logo erscheint als Wasserzeichen mittig im unteren Tabellen-/Anmerkungsbereich, entsprechend dem früheren Erscheinungsbild.
- Die bestehenden zentralen Firmendaten werden unten im PDF ausgegeben.
- Keine hart codierten Ersatz-Firmendaten, wenn zentrale Einstellungen vorhanden sind.

### Mitarbeiterseiten

- Jeder Mitarbeiter beginnt auf einer eigenen PDF-Seite.
- Bei langen Zeiträumen darf ein Mitarbeiter auf Folgeseiten weiterlaufen; Daten verschiedener Mitarbeiter werden nicht auf derselben begonnenen Mitarbeiterseite vermischt.
- Kopfbereich und Tabellenkopf werden auf Folgeseiten wiederholt.

## Mobile Stundenzettel-Ansicht

Auf schmalen Geräten, insbesondere iPhone, darf die Bearbeitung nicht mehr außerhalb des sichtbaren Bereichs liegen.

### Darstellung

- Stundenzettel-Einträge werden mobil als kompakte Tages-/Schichtkarten dargestellt.
- Jede Karte zeigt mindestens:
  - Mitarbeiter
  - Datum
  - Beginn
  - Ende
  - Pause
  - Dauer
  - Bereich
  - Einsatzort
- Ein gut sichtbarer Button **Bearbeiten** steht direkt auf jeder Karte.
- Kein horizontales Wischen ist nötig, um „Bearbeiten“ zu erreichen.

Auf breiteren Desktop-/Tablet-Ansichten kann die bestehende Tabelle beibehalten werden, sofern alle Aktionen sichtbar und bedienbar bleiben.

## Bearbeiten

Berechtigte Managementrollen können einen Stundenzettel-Eintrag öffnen und folgende Felder ändern:

- Datum
- Beginn
- Ende
- Pause in Minuten
- Tätigkeit/Bereich
- Einsatzort

Die Netto-Dauer wird aus Beginn, Ende und Pause neu berechnet.

Im Editor stehen klar sichtbar:

- **Speichern**
- **Löschen**
- **Abbrechen/Schließen**

Ungültige Werte werden nicht gespeichert, insbesondere:

- fehlender Beginn oder Ende
- Ende ohne gültige Zeitspanne
- negative Pause
- Pause länger als Bruttoarbeitszeit

## Löschen

„Löschen“ entfernt **nur den Stundenzettel-Eintrag**. Der zugrunde liegende Dienstplan und das Stempelprotokoll werden dadurch nicht verändert.

Damit der Eintrag während eines noch offenen Monats nicht sofort durch die automatische Dienstplan-Synchronisierung wieder erscheint, wird die Löschung als bewusste manuelle Unterdrückung/Tombstone für genau diese Dienstplanschicht gespeichert.

- spätere automatische Synchronisierung darf den gelöschten Stundenzettel-Eintrag nicht still wiederherstellen
- der Dienstplan bleibt unverändert
- das Stempelprotokoll bleibt unverändert
- eine bewusste Management-Aktion **„Dienstplan übernehmen“** kann den gelöschten/manuell überschriebenen Eintrag wieder aus dem aktuellen Dienstplan herstellen, solange dies fachlich zulässig ist

Löschungen werden auditiert.

## Manuelle Bearbeitung und Monatsfrist

Die bestehende Monatsregel bleibt erhalten:

- aktueller Monat synchronisiert aus Dienstplan
- Korrekturphase bis einschließlich 10. des Folgemonats
- ab 11. um 00:00 Uhr Europe/Berlin keine automatische Änderung des vergangenen Monats mehr
- Management darf alte/fixierte Stundenzettel weiterhin manuell ändern oder löschen
- manuelle Änderungen wirken nur auf den Stundenzettel

Eine manuell geänderte oder gelöschte Zeile wird nicht durch spätere automatische Dienstplan-Synchronisierung überschrieben.

## Rollen und Rechte

Bearbeiten, Speichern und Löschen stehen nur den bestehenden berechtigten Managementrollen zur Verfügung:

- Chef/Hauptadmin bzw. Owner
- Admin
- Einsatzleiter/Manager im Rahmen der bestehenden Berechtigungen

Mitarbeiter dürfen ihre eigenen Stundenzettel sehen, aber keine administrativen Änderungen oder Löschungen durchführen, sofern die bestehende Rollenregel nichts Weiteres erlaubt.

## Export

- PDF und Excel bleiben im Bereich **Stundenzettel** verfügbar.
- Der PDF-Export verwendet das hier definierte frühere Habun-Layout.
- Der Excel-Export bleibt funktional und verwendet dieselben Stundenzettel-Daten; eine optische 1:1-Kopie des PDFs ist für Excel nicht erforderlich.
- Der Stempelprotokoll-Export bleibt separat und wird nicht in den Stundenzettel eingebaut.

## Fehlerbehandlung

- Kann ein Eintrag nicht gespeichert oder gelöscht werden, bleibt der bisherige Datensatz erhalten und es erscheint eine verständliche Fehlermeldung.
- Doppelte Lösch-/Speicheranfragen müssen idempotent bzw. sicher behandelt werden.
- Ein PDF-Fehler darf keine Stundenzetteldaten verändern.
- Fehlt das Firmenlogo technisch, soll das PDF trotzdem erzeugbar bleiben; die übrigen Firmeninformationen und Tabellen müssen erhalten bleiben.

## Tests und Abnahmekriterien

Die Änderung gilt erst als fertig, wenn mindestens Folgendes nachgewiesen ist:

1. PDF-Titel lautet **Stundenzettel**.
2. PDF zeigt pro Mitarbeiter eine eigene beginnende Seite.
3. PDF enthält goldene Tabellenkopfzeile, Gesamtdauer und Anmerkungsfeld.
4. Zentrales Habun-Logo erscheint ohne störenden schwarzen Kasten.
5. Dezentes Logo-Wasserzeichen wird mittig dargestellt.
6. Zentrale Firmendaten werden im PDF verwendet.
7. Tabelle enthält Datum, Startzeit, Endzeit, Pause, Dauer, Status und Tätigkeit/Einsatzort.
8. Leere Kalendertage des gewählten Zeitraums werden als leere Zeilen dargestellt.
9. Stempel-/Attendance-Daten erscheinen nicht als Stundenzettelquelle.
10. Status ist für synchronisierte Zeilen „Dienstplan“ und für manuelle Zeilen „Manuell“.
11. Mobile Ansicht zeigt jeden Eintrag ohne horizontales Suchen mit sichtbarem **Bearbeiten**-Button.
12. Bearbeiten von Uhrzeit, Pause, Bereich und Einsatzort funktioniert.
13. Speichern berechnet die Dauer korrekt neu.
14. Löschen entfernt nur den Stundenzettel, nicht Dienstplan oder Stempelprotokoll.
15. Gelöschte/manuell überschriebene Einträge werden durch offene Monats-Synchronisierung nicht still wiederhergestellt.
16. Manuelle Altmonat-Korrekturen funktionieren weiterhin nach der Monatsfrist.
17. PDF- und Excel-Download funktionieren weiter.
18. Stempelprotokoll und dessen Export bleiben getrennt.
19. Desktop-, iPhone- und Android-Browserprüfungen sind grün.
20. Vor Veröffentlichung laufen vollständige Repository-Verifikation, Build und E2E-Prüfung erfolgreich durch.

## Nicht-Ziele

- Keine Rückkehr zur früheren Mischung aus Dienstplan und Stempelzeiten.
- Keine automatische Korrektur des Stundenzettels anhand von Stempeldaten.
- Keine Änderung des Dienstplans durch Bearbeiten oder Löschen eines Stundenzettels.
- Keine neue allgemeine Berichteseite.
- Keine neue Freitext-Datenbankfunktion für das Anmerkungsfeld in dieser Änderung.
