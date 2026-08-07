# Admin-Zeitbearbeitung

## Ziel

Chef/Hauptadmin (`owner`) und Admin (`admin`) können bestehende Arbeitszeiteinträge direkt in der Seite **Zeiten** bearbeiten, auch wenn ein Dienst bereits abgeschlossen ist. Einsatzleiter (`manager`) und Mitarbeiter (`employee`) erhalten keine direkte Bearbeitungsfunktion.

## Oberfläche

- Jeder zusammengefasste Zeiteintrag zeigt für `owner` und `admin` einen Button **Bearbeiten**.
- Bearbeitbar sind Arbeitsbeginn, Arbeitsende und Pause in Minuten.
- Der Dialog zeigt die aktuellen Werte und speichert erst nach ausdrücklicher Bestätigung.
- Nach erfolgreichem Speichern wird die Liste neu geladen; Nettozeit, Tageswert und Gesamtsumme werden aus den geänderten Werten neu berechnet.
- Bei ungültigen Eingaben wird eine klare Fehlermeldung gezeigt und nichts gespeichert.

## Berechtigungen

- Direkte Änderung ausschließlich für `owner` und `admin`.
- `manager` bleibt lesend in der Seite Zeiten und nutzt weiterhin den vorhandenen Korrekturprozess, sofern erforderlich.
- `employee` kann keine fremden Daten sehen und keine direkten Änderungen ausführen.
- Die Berechtigung wird serverseitig geprüft, nicht nur über die Oberfläche.

## Datenfluss

1. Die Seite lädt die Arbeitszeit-Historie wie bisher.
2. Für `owner`/`admin` wird pro Dienst eine Bearbeitungsaktion angeboten.
3. Beim Speichern sendet die Oberfläche die betroffenen Event-IDs sowie neue Beginn-/Endzeit und Pause an die Wartungs-API.
4. Die API validiert Rolle, Zugehörigkeit der Events, Reihenfolge der Zeiten und Pausenwert.
5. Die wirksamen Werte werden serverseitig aktualisiert bzw. als nachvollziehbare Anpassung gespeichert.
6. Ein Audit-Eintrag enthält Vorher-/Nachher-Werte, handelnde Person, Rolle, Zeitpunkt und Begründung/Änderungsnotiz.
7. Anschließend lädt die Oberfläche den Zeitraum neu und berechnet die Anzeige aus den wirksamen Daten.

## Validierung

- Beginn und Ende müssen gültige Zeitpunkte sein.
- Ende darf nicht vor Beginn liegen.
- Pause muss eine ganze Zahl ab 0 sein und darf die Bruttoarbeitszeit nicht überschreiten.
- Ein abgeschlossener Dienst bleibt nach der Änderung abgeschlossen, solange Beginn und Ende vorhanden sind.
- Standortdaten werden durch diese Funktion nicht verändert.

## Kontrollverlauf

Die ursprünglichen Werte müssen nachvollziehbar bleiben. Jede direkte Admin-Änderung wird in `attendance_audit_log` dokumentiert. Standortmessungen und ursprüngliche Standortstatus werden nicht überschrieben.

## Tests

- `owner` kann abgeschlossenen Dienst ändern.
- `admin` kann abgeschlossenen Dienst ändern.
- `manager` erhält keinen direkten Bearbeiten-Button und serverseitig 403 bei direktem Änderungsversuch.
- `employee` erhält keinen Zugriff.
- Beginn/Ende/Pause werden korrekt übernommen.
- Ungültige Reihenfolge und ungültige Pause werden abgewiesen.
- Nettozeit und Gesamtsumme aktualisieren sich nach dem Neuladen korrekt.
- Audit-Eintrag enthält Vorher-/Nachher-Werte.
- Bestehende Stempeluhr-, Dienstplan- und Berichtsfunktionen bleiben unverändert.

## Veröffentlichung

Die Änderung wird erst nach erfolgreichen Tests in den produktiven Hauptbereich veröffentlicht.