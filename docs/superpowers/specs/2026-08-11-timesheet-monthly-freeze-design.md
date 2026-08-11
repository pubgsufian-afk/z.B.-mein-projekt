# Stundenzettel: Monatslogik, Korrekturfrist und getrennte Stempelzeiten

Datum: 11.08.2026

## Ziel

Der Stundenzettel soll nicht mehr mit echten Stempelzeiten vermischt werden. Er basiert auf dem Dienstplan und bleibt für einen begrenzten Korrekturzeitraum mit diesem synchron. Danach bleibt der Monatsstand unverändert, außer ein berechtigter Nutzer korrigiert den Stundenzettel selbst.

Stempelungen bleiben ein eigener Datenbereich. Sie können separat angezeigt, verglichen und exportiert werden, verändern aber niemals den Stundenzettel.

## Fachliche Regeln

### 1. Quelle des Stundenzettels

- Der Stundenzettel wird aus veröffentlichten Dienstplan-Schichten aufgebaut.
- Entwürfe (`draft`) gehören nicht in den Stundenzettel.
- Übernommen werden mindestens Mitarbeiter, Datum, Beginn, Ende, Pause, Nettozeit, Einsatzort und Bereich.
- Stempelereignisse (`clock-in`, Pause, `clock-out`) überschreiben keinen Stundenzettel-Eintrag.

### 2. Offener Monat und Korrekturfrist

Für einen Monat M gilt eine Korrekturfrist bis einschließlich zum 10. des Folgemonats.

Beispiel August 2026:

- 01.08. bis 31.08.: August ist laufender Monat.
- 01.09. bis einschließlich 10.09.: August bleibt in der Korrekturphase.
- Ab 11.09. 00:00 Uhr Europe/Berlin: August ist abgeschlossen.

Während des laufenden Monats und der Korrekturphase werden Änderungen an veröffentlichten Dienstplan-Schichten automatisch in den zugehörigen Stundenzettel übernommen.

Die Zeitgrenze selbst ist maßgeblich. Jede Synchronisierung muss anhand von `Europe/Berlin` prüfen, ob die Korrekturfrist noch offen ist. Ein verspäteter Hintergrundjob oder ein noch nicht aktualisierter Monatsstatus darf die Frist niemals über den 10. hinaus verlängern.

### 3. Verhalten nach Ablauf der Korrekturfrist

- Nach dem 10. des Folgemonats führen spätere Änderungen am alten Dienstplan nicht mehr zu Änderungen am abgeschlossenen Stundenzettel.
- Der Monats-Stundenzettel behält seinen zuletzt gültigen Stand aus der Korrekturphase.
- Der alte Dienstplan darf unabhängig davon weiterhin geändert werden; diese Änderungen wirken nicht rückwirkend auf den abgeschlossenen Stundenzettel.

### 4. Manuelle Stundenzettel-Korrekturen

- Berechtigte Management-Rollen dürfen Stundenzettel auch nach Ablauf der Korrekturfrist manuell ändern.
- Eine manuelle Änderung betrifft ausschließlich den Stundenzettel und verändert nicht den Dienstplan.
- Manuelle Stundenzettel-Korrekturen werden mit vorherigem Wert, neuem Wert, Bearbeiter, Zeitpunkt und Begründung auditiert.
- Während eines noch offenen Monats oder einer noch offenen Korrekturphase hat eine bewusste manuelle Stundenzettel-Korrektur Vorrang für genau den bearbeiteten Eintrag. Eine spätere Dienstplan-Synchronisierung darf diesen manuellen Wert nicht stillschweigend überschreiben. Der Eintrag kann bei Bedarf ausdrücklich wieder auf "Dienstplan übernehmen" zurückgesetzt werden.

### 5. Stempelzeiten bleiben getrennt

Die Zeiterfassung ist ein eigener Bereich und hat keine automatische Schreibwirkung auf Stundenzettel.

Dort sollen Management-Nutzer:

- die tatsächlichen Stempelungen separat sehen,
- den Zeitraum und Mitarbeiter filtern,
- Stempelzeiten separat als PDF und Excel herunterladen,
- einen Vergleich "Dienstplan/Stundenzettel ↔ Stempelzeit" aufrufen können.

Der Vergleich ist rein informativ. Abweichungen werden angezeigt, aber nicht automatisch korrigiert.

## Datenmodell

### Stundenzettel-Monate

Ein eigener Monatsstatus wird benötigt, beispielsweise:

- `month` (`YYYY-MM`)
- `status` (`open` oder `closed`)
- `correction_deadline` (10. des Folgemonats, Ende des Tages Europe/Berlin)
- `closed_at`
- Audit-Metadaten

Der gespeicherte Status dient der Darstellung und Verwaltung. Für die Frage, ob Dienstplanänderungen noch synchronisiert werden dürfen, ist zusätzlich immer die tatsächliche Korrekturfrist anhand der Berliner Zeit zu prüfen.

### Stundenzettel-Einträge

Stundenzettel-Einträge werden unabhängig von `attendance_events` gespeichert. Sie enthalten mindestens:

- Mitarbeiter-ID und angezeigten Namen
- Datum
- Beginn und Ende
- Pause
- Netto-Minuten
- Einsatzort und Bereich
- Referenz auf die Dienstplan-Schicht, soweit vorhanden
- Herkunft (`schedule` oder `manual`)
- Kennzeichen für manuellen Override
- Erstellungs-/Änderungszeit und Bearbeiter

Damit existiert bereits während der offenen Phase ein eigener Stundenzettel-Stand. Dienstplanänderungen aktualisieren diesen Stand nur solange die Frist offen ist und nur dort, wo kein manueller Override besteht.

## Synchronisationsfluss

### Veröffentlichung oder Änderung eines Dienstplans

1. Eine veröffentlichte Schicht wird erstellt, geändert oder gelöscht.
2. Das System ermittelt den betroffenen Monat und die Korrekturfrist in `Europe/Berlin`.
3. Ist die Korrekturfrist noch offen, wird der entsprechende Stundenzettel-Eintrag erstellt, aktualisiert oder entfernt.
4. Ist der Eintrag manuell überschrieben, bleibt der manuelle Wert bestehen.
5. Ist die Korrekturfrist abgelaufen, wird am Stundenzettel nichts geändert – unabhängig davon, ob ein Monatsabschluss-Job bereits gelaufen ist.

### Monatsabschluss

- Der Monatsstatus wechselt nach Ablauf des 10. des Folgemonats auf `closed`.
- Der vorhandene Stundenzettel-Stand bleibt unverändert erhalten.
- Ein technischer Abschlusslauf darf den Status setzen, aber keine Stunden neu aus dem zu diesem Zeitpunkt eventuell schon geänderten Alt-Dienstplan rekonstruieren.
- Falls der Abschlusslauf verspätet ist oder ausfällt, schützt die Fristprüfung trotzdem vor nachträglicher Dienstplan-Synchronisierung.

### Manuelle Korrektur eines abgeschlossenen Monats

1. Berechtigter Nutzer öffnet den alten Stundenzettel.
2. Er ändert den konkreten Eintrag und gibt eine Begründung an.
3. Nur der Stundenzettel-Eintrag wird aktualisiert.
4. Der Dienstplan bleibt unverändert.
5. Die Änderung wird vollständig im Audit protokolliert.

## Stempelvergleich

Der Vergleich wird zur Laufzeit aus zwei unabhängigen Quellen erzeugt:

- Stundenzettel/Dienstplan-Seite: Soll- bzw. abgerechneter Stand
- `attendance_events`: tatsächliche Stempelereignisse

Mögliche Vergleichsanzeigen:

- geplanter bzw. abgerechneter Beginn/Ende
- gestempelter Beginn/Ende
- Stundenzettel-Pause
- gestempelte Pause
- Differenz Netto-Minuten
- fehlendes Ein- oder Ausstempeln
- Stempelung ohne passenden Dienst

Keine dieser Abweichungen führt automatisch zu einer Änderung am Stundenzettel.

## Berechtigungen

- Chef/Hauptadmin/Admin/Einsatzleitung verwenden die bestehenden Management-Rollen des Portals.
- Nur diese Management-Rollen dürfen fremde Stundenzettel ansehen, korrigieren und Vergleichs-/Exportfunktionen für Mitarbeiter verwenden.
- Mitarbeiter sehen weiterhin nur die für sie vorgesehenen eigenen Informationen; sie dürfen keine administrativen Stundenzettel-Korrekturen durchführen.

## Bestehende Daten / Übergang

- Der aktuelle August 2026 wird als offener Monat behandelt.
- Für August werden die Stundenzettel aus dem aktuell gültigen veröffentlichten Dienstplan aufgebaut; die bereits bestätigten Pausen- und Dienstplankorrekturen müssen dabei berücksichtigt werden.
- Vorhandene alte Stundenzettel dürfen bei der Umstellung nicht aus später veränderten Alt-Dienstplänen neu berechnet werden. Bereits existierende alte Monatsstände werden als Ausgangsstand übernommen und abgeschlossen.
- Stempel-Testdaten und echte Stempelprotokolle bleiben getrennt vom Stundenzettel.

## Fehlerbehandlung und Sicherheit

- Synchronisationen und manuelle Änderungen müssen idempotent sein, damit Wiederholungen keine Duplikate erzeugen.
- Ein Stundenzettel-Eintrag darf nicht durch mehrere identische Dienstplanereignisse doppelt angelegt werden.
- Manuelle Overrides dürfen durch Hintergrund-Synchronisation nicht verloren gehen.
- Jede manuelle Änderung und jeder Monatsabschluss wird auditiert.
- Bei einem fehlgeschlagenen Monatsabschluss bleibt der vorhandene Stundenzettel-Stand erhalten; es findet keine Rekonstruktion aus später veränderten Dienstplandaten statt.
- Die Korrekturfrist muss serverseitig geprüft werden; die Benutzeroberfläche allein darf sie nicht erzwingen.

## Tests / Abnahmekriterien

1. Dienstplanänderung im laufenden Monat aktualisiert den Stundenzettel.
2. Dienstplanänderung am 10. des Folgemonats aktualisiert den Vormonat noch.
3. Dienstplanänderung ab dem 11. verändert den Vormonats-Stundenzettel nicht mehr.
4. Auch bei verspätetem oder ausgefallenem Monatsabschluss-Job verändert eine Dienstplanänderung ab dem 11. den Vormonat nicht.
5. Manuelle Änderung eines abgeschlossenen Stundenzettels funktioniert und ändert den Dienstplan nicht.
6. Ein manueller Override in einer offenen Phase wird durch spätere Dienstplan-Synchronisierung nicht überschrieben.
7. Stempelungen verändern niemals Stundenzettelwerte.
8. Stempelvergleich zeigt Abweichungen, ohne Daten zu verändern.
9. PDF/Excel des Stundenzettels enthält nur Stundenzetteldaten; Stempelprotokoll besitzt einen eigenen Export.
10. Mehrere Dienste an einem Tag erzeugen keine doppelte Abrechnung durch die Stempelzeit.
11. Wiederholte Synchronisierung desselben Dienstplans erzeugt keine Duplikate.

## Nicht-Ziele

- Keine automatische Korrektur des Stundenzettels anhand der Stempelzeit.
- Keine rückwirkende Änderung abgeschlossener Monats-Stundenzettel durch alte Dienstplanänderungen.
- Keine Änderung des Dienstplans durch manuelle Stundenzettel-Korrekturen.
