# Habun Portal – Datenaktualisierung und automatische Zeiterfassung

## Ziel

Zwei klar getrennte Verbesserungen werden umgesetzt, ohne die bestehende Anmeldung zu verändern:

1. Die installierte Web-App soll beim Zurückkehren aus dem Hintergrund automatisch frische Daten laden, ohne dass Nutzer die App vollständig schließen und neu öffnen müssen.
2. Die Zeiterfassung soll einen ausdrücklich konfigurierten Sonderaccount unterstützen und vergessene Check-outs automatisch beenden.

## Datenschutz und Konfiguration

Der konkrete Sonderaccount wird nicht mit Name oder E-Mail im öffentlichen Repository hinterlegt. Die Zuordnung erfolgt über eine private, serverseitige Konfiguration. Die Ausnahme gilt ausschließlich für diesen einen konfigurierten Account.

## A. Aktualisierung und Geschwindigkeit der Web-App

### Verhalten

- Vorhandene Daten bleiben beim Navigieren sichtbar, damit keine leeren oder `0`-Zwischenstände erscheinen.
- Sobald die App aus dem Hintergrund wieder sichtbar wird, werden die gerade relevanten Daten neu vom Server geladen.
- Beim Wechsel zurück zur App wird kein vollständiger Seiten-Reload erzwungen.
- Wichtige Ansichten wie Dienstplan, Zeiterfassung und Verwaltungsübersichten erhalten ein einheitliches Refresh-Verhalten.
- API-Abfragen bleiben `no-store`, sodass ein ausgelöster Refresh frische Serverdaten liefert.
- Während die App sichtbar und aktiv ist, dürfen relevante Ansichten zusätzlich in einem schonenden Intervall aktualisiert werden; parallele Doppelabfragen werden vermieden.

### Fehlerverhalten

- Bei einem fehlgeschlagenen Hintergrund-Refresh bleiben die zuletzt sichtbaren Daten erhalten.
- Fehler werden nicht als leere Seite dargestellt.
- Ein späterer erfolgreicher Refresh ersetzt die alten Daten automatisch.

## B. Sonderaccount ohne vorhandenen Dienstplan

### Berechtigung

- Nur der privat konfigurierte Sonderaccount darf ohne bereits vorhandenen Dienstplan einen Check-in starten.
- Alle anderen Mitarbeiter behalten unverändert die bestehende Pflicht eines freigegebenen Dienstes.
- Der Sonderaccount darf nur an einem bereits im Portal gespeicherten Einsatzort einchecken.
- Die bestehende Standortprüfung bleibt aktiv; außerhalb eines erlaubten Bereichs wird der Check-in abgelehnt.

### Automatischer Dienstplan-Eintrag

Bei erfolgreichem Check-in des Sonderaccounts ohne vorhandenen Dienst:

- wird serverseitig genau ein neuer Dienstplan-Eintrag erstellt,
- `employeeUserId` wird an den echten Account gebunden,
- der Anzeigename wird aus dem freigegebenen Konto übernommen,
- Datum und Startzeit entsprechen dem tatsächlichen Check-in,
- Einsatzort und Objekt werden aus der erfolgreich geprüften Standortzuordnung übernommen,
- der Eintrag wird direkt als veröffentlicht gespeichert,
- der Eintrag erhält eine interne Kennzeichnung, dass er automatisch aus der Zeiterfassung entstanden ist,
- als vorläufiges geplantes Ende wird exakt `Check-in + 12 Stunden` hinterlegt, damit der Dienst sofort vollständig im Plan sichtbar ist.

Wenn das 12-Stunden-Ende auf den Folgetag fällt, darf dieser systemerzeugte Dienst über Mitternacht laufen. Die bestehende manuelle Dienstplan-Validierung für normale, von Menschen angelegte Dienste bleibt davon unberührt.

Beim normalen Check-out wird die Endzeit dieses automatisch erzeugten Dienstes auf die tatsächliche Check-out-Zeit gesetzt. Die Zeiterfassungsereignisse bleiben die maßgebliche Quelle für die tatsächlich gearbeitete Zeit.

## C. Automatisches Auschecken

### Sonderaccount

- Wenn der Sonderaccount nicht selbst auscheckt, wird der offene Dienst exakt 12 Stunden nach dem Check-in automatisch beendet.
- Das automatisch gespeicherte Check-out-Ereignis trägt als Arbeitsende exakt `Check-in + 12 Stunden`, auch wenn der serverseitige Prüflauf einige Minuten später stattfindet.
- Das automatische Ende wird als systemseitiger Check-out gespeichert und im Audit nachvollziehbar gekennzeichnet.
- Der zugehörige automatisch erzeugte Dienstplan-Eintrag erhält dieselbe Endzeit.

### Normale Mitarbeiter

- Für Mitarbeiter mit geplantem Dienst gilt die im Dienstplan gespeicherte Endzeit.
- Ist 30 Minuten nach dem geplanten Dienstende noch kein Check-out vorhanden, erzeugt der Server automatisch einen Check-out.
- Beispiel: geplanter Dienst bis 22:00 Uhr → gespeichertes automatisches Arbeitsende exakt 22:30 Uhr.
- Ein bereits manuell ausgecheckter Dienst wird niemals nochmals automatisch beendet.
- Auch bei Diensten über Mitternacht wird das korrekte absolute Enddatum berücksichtigt.

### Serverseitige Ausführung

- Die Prüfung läuft serverseitig nach Zeitplan und ist nicht von einer geöffneten App oder einem eingeschalteten Handy abhängig.
- Die Aufgabe verarbeitet nur tatsächlich offene Arbeitsphasen.
- Der Prüflauf darf in einem kurzen Intervall, beispielsweise alle fünf Minuten, laufen; die gespeicherte automatische Endzeit bleibt trotzdem der exakte Schwellenzeitpunkt.
- Wiederholte Ausführungen müssen idempotent sein; derselbe offene Dienst darf nicht doppelt ausgecheckt werden.

## D. Datenintegrität

- Bestehende Standortregeln bleiben unverändert.
- Bestehende Rollen- und Zugriffsrechte bleiben unverändert.
- Die Ausnahme für den Sonderaccount darf nicht auf andere Accounts übertragbar sein.
- Automatisch erzeugte Check-outs und Dienstplan-Einträge werden mit einer Systemquelle/Audit-Kennzeichnung gespeichert.
- Arbeitszeiten dürfen sich durch die Automatik nicht mit einem nachfolgenden bereits vorhandenen Dienst überschneiden.
- Bei Konflikten wird keine verdeckte Korrektur vorgenommen; stattdessen wird der Vorgang protokolliert und für die Verwaltung sichtbar gemacht.
- Die automatische Check-out-Logik darf vorhandene Pausenereignisse nicht verändern oder löschen.

## E. Tests

Mindestens folgende Fälle werden automatisiert geprüft:

1. Normaler Mitarbeiter ohne Dienst kann weiterhin nicht einchecken.
2. Sonderaccount ohne Dienst kann an gespeichertem Einsatzort einchecken.
3. Sonderaccount außerhalb eines gespeicherten Einsatzortes wird abgelehnt.
4. Check-in des Sonderaccounts erzeugt genau einen veröffentlichten Dienstplan-Eintrag.
5. Automatisch erzeugter Sonderdienst kann korrekt über Mitternacht laufen.
6. Normaler Check-out aktualisiert die Endzeit des automatisch erzeugten Dienstes.
7. Sonderaccount wird nach 12 Stunden automatisch ausgecheckt, falls noch offen.
8. Normaler Mitarbeiter wird 30 Minuten nach geplantem Dienstende automatisch ausgecheckt, falls noch offen.
9. Die gespeicherte automatische Endzeit entspricht dem exakten Schwellenzeitpunkt und nicht der späteren Scheduler-Ausführungszeit.
10. Bereits ausgecheckte Dienste bleiben unverändert.
11. Wiederholte Scheduler-Läufe erzeugen keine doppelten Check-outs.
12. Rückkehr aus dem App-Hintergrund lädt frische Dienstplan- und Zeiterfassungsdaten, ohne die Seite komplett neu zu laden.
13. Bei fehlgeschlagenem Refresh bleiben die zuletzt sichtbaren Daten erhalten.

## Nicht im Umfang

- Änderung der Login-Dauer oder des Anmeldeverhaltens.
- Ausnahme für weitere Mitarbeiter.
- Deaktivierung der Standortprüfung.
- Änderungen an bestehenden Rollen oder Adminrechten.
