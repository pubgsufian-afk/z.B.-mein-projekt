# Stundenzettel statt Korrekturen

Datum: 2026-08-08

## Ziel

Der bisherige Bereich „Korrekturen“ wird im Habun-Mitarbeiterportal vollständig ersetzt. An seiner Stelle entsteht ein zentraler Bereich „Stundenzettel“, in dem tatsächliche gestempelte Arbeitszeiten und geplante Dienstplanstunden klar getrennt angezeigt und verwaltet werden.

## Navigation und Oberfläche

- Der Menüpunkt „Korrekturen“ wird entfernt und durch „Stundenzettel“ ersetzt.
- Die bisherige Seite „Korrektur beantragen“ mit Buchung, gewünschtem Beginn, gewünschtem Ende, Pause, Bemerkung und Begründung entfällt vollständig.
- Das bestehende Habun-Security-Design, Logo, Farbschema und die mobile Darstellung bleiben unverändert.
- Die Seite „Stundenzettel“ erhält zwei klar getrennte Bereiche:
  1. „Arbeitsstunden – tatsächlich“
  2. „Dienstplanstunden – geplant“

## Arbeitsstunden – tatsächlich

Dieser Bereich zeigt die real erfassten Zeitstempel aus der Zeiterfassung.

Pro Mitarbeiter und Kalendertag werden mindestens angezeigt:
- Datum
- Mitarbeiter
- Arbeitsbeginn
- Arbeitsende
- Pause
- berechnete Nettoarbeitszeit
- optional Einsatzort/Objekt, sofern im vorhandenen Datenmodell verfügbar

Berechtigte Rollen können:
- einen vorhandenen Tagesstundenzettel bearbeiten,
- fehlende Arbeitszeiten für einen Tag manuell nachtragen,
- Beginn, Ende und Pause korrigieren,
- die daraus berechnete Nettoarbeitszeit aktualisieren lassen.

Die Bearbeitung darf die vorhandene Zeiterfassungslogik nicht zerstören. Vorhandene Daten sollen weiter nachvollziehbar bleiben, soweit das bestehende System bereits einen Änderungs- oder Kontrollverlauf vorsieht.

## Dienstplanstunden – geplant

Dieser Bereich ist vollständig von den tatsächlich gestempelten Zeiten getrennt.

Er zeigt je Mitarbeiter die im Dienstplan vorgesehenen Schichten und Stunden, mindestens mit:
- Datum
- geplante Startzeit
- geplante Endzeit
- geplante Pause, sofern vorhanden
- geplante Netto-Stunden
- Einsatzort/Objekt

Zusätzlich werden Summen gebildet:
- Summe der geplanten Dienstplanstunden je Mitarbeiter für den gewählten Zeitraum
- Gesamtsumme über alle ausgewählten Mitarbeiter für den gewählten Zeitraum

Geplante Dienstplanstunden dürfen nicht mit tatsächlichen Arbeitsstunden vermischt oder als tatsächliche Arbeitszeit gespeichert werden.

## Filter und Auswahl

Für beide Bereiche werden vorhandene Portal-Filter wiederverwendet oder passend ergänzt:
- Mitarbeiter auswählen
- Von-Datum
- Bis-Datum
- sinnvoller Standardzeitraum, z. B. aktueller Monat

Die Auswahl eines einzelnen Mitarbeiters zeigt dessen Einzelübersicht. Eine Auswahl aller Mitarbeiter zeigt die Gesamtauswertung.

## Download und Export

Beide Datenarten müssen getrennt heruntergeladen werden können.

Mindestens erforderlich:
- tatsächliche Arbeitsstunden eines einzelnen Mitarbeiters
- tatsächliche Arbeitsstunden aller ausgewählten Mitarbeiter
- geplante Dienstplanstunden eines einzelnen Mitarbeiters
- geplante Dienstplanstunden aller ausgewählten Mitarbeiter

Die Exporte sollen die sichtbare Zeitraumsauswahl respektieren und jeweils die Einzel- und Gesamtsummen enthalten.

Bestehende Exportwege für PDF und Excel sollen genutzt werden, sofern sie zuverlässig funktionieren. Falls die vorhandenen Exportfunktionen fehlerhaft sind, werden sie im Rahmen dieser Änderung so angepasst, dass die Downloads für diesen Bereich funktionieren.

## Rollen und Rechte

- Hauptadmin/Admin: darf alle Mitarbeiter sehen, tatsächliche Stundenzettel bearbeiten und fehlende Einträge anlegen sowie geplante Dienstplanstunden sehen und exportieren.
- Einsatzleiter: darf im Rahmen der bereits bestehenden Rollen- und Standortberechtigungen die zugeordneten Mitarbeiter sehen und deren tatsächliche Stundenzettel bearbeiten bzw. ergänzen sowie geplante Stunden sehen und exportieren.
- Mitarbeiter: sieht nur die eigenen Daten. Keine Bearbeitung fremder Daten und keine Gesamtauswertung über andere Mitarbeiter.

Die bereits vereinbarte eingeschränkte Mitarbeiteransicht bleibt bestehen.

## Datenfluss

1. Tatsächliche Arbeitszeiten werden aus der bestehenden Zeiterfassung/Attendance-Datenquelle geladen.
2. Geplante Stunden werden getrennt aus der bestehenden Dienstplan-/Schedule-Datenquelle geladen.
3. Beide Datensätze werden im Frontend getrennt dargestellt.
4. Änderungen an tatsächlichen Zeiten werden ausschließlich über die bestehende bzw. dafür vorgesehene Attendance-Bearbeitung gespeichert.
5. Dienstplandaten werden durch diese Seite nur gelesen und ausgewertet; eine Bearbeitung des Dienstplans erfolgt weiterhin im Dienstplanbereich.
6. Exporte verwenden die jeweils gefilterten Daten der ausgewählten Kategorie.

## Fehlerbehandlung

- Wenn tatsächliche Arbeitszeiten nicht geladen werden können, erscheint eine verständliche Fehlermeldung nur im Bereich „Arbeitsstunden – tatsächlich“.
- Wenn Dienstplanstunden nicht geladen werden können, bleibt der Bereich mit tatsächlichen Arbeitszeiten weiterhin nutzbar und umgekehrt.
- Fehlgeschlagene Änderungen dürfen keinen bestehenden Zeiteintrag überschreiben.
- Bei unvollständigen Zeitpaaren, z. B. Beginn ohne Ende, wird der Tag sichtbar als unvollständig markiert statt eine falsche Gesamtzeit zu berechnen.
- Exportfehler werden sichtbar gemeldet; ein fehlgeschlagener Export darf die Seite nicht blockieren.

## Mobile Darstellung

Die Seite muss auf dem iPhone genauso nutzbar sein wie die übrigen Portalbereiche:
- keine horizontal abgeschnittenen Pflichtfelder,
- kompakte Tageskarten bzw. responsive Tabellen,
- Bearbeiten-Aktion gut erreichbar,
- Filter und Download-Schaltflächen ohne Überlappung,
- keine Änderung des bestehenden Farb- und Markenlayouts.

## Abnahmekriterien

Die Änderung gilt als fertig, wenn:
- „Korrekturen“ aus Navigation und Seite verschwunden ist,
- „Stundenzettel“ an dessen Stelle vorhanden ist,
- tatsächliche gestempelte Zeiten je Tag korrekt angezeigt werden,
- berechtigte Rollen vorhandene Zeiten bearbeiten und fehlende Tage eintragen können,
- geplante Dienstplanstunden klar getrennt angezeigt werden,
- Einzel- und Gesamtsummen für geplante Stunden korrekt berechnet werden,
- tatsächliche und geplante Stunden jeweils getrennt exportierbar sind,
- Rollenrechte eingehalten werden,
- die Ansicht auf Mobilgeräten funktioniert,
- bestehende Zeiterfassung und Dienstplanfunktionen durch die Änderung nicht beschädigt werden.

## Tests

Vor Veröffentlichung werden mindestens geprüft:
- Admin: einzelne tatsächliche Zeit bearbeiten
- Admin: fehlenden Tag manuell eintragen
- Einsatzleiter: nur erlaubte Mitarbeiterdaten bearbeiten
- Mitarbeiter: ausschließlich eigene Daten sehen
- tatsächliche Stunden für mehrere Tage summieren
- geplante Dienstplanstunden für einzelne und mehrere Mitarbeiter summieren
- Zeitraumfilter
- PDF-Export tatsächliche Stunden
- Excel-Export tatsächliche Stunden
- PDF-Export geplante Stunden
- Excel-Export geplante Stunden
- unvollständige Stempelung
- mobile Darstellung auf schmaler Breite
- Regressionstest für Zeiterfassung, Dienstplan und vorhandene Rollenlogik
