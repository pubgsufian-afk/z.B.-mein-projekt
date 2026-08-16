# Vorläufige Mitarbeiter im Dienstplan und Stundenzettel

## Ziel

Nicht registrierte Mitarbeiter sollen bereits im Dienstplan geführt werden können, damit ihre geplanten Arbeitszeiten automatisch im Stundenzettel erscheinen und am Monatsende zusammen mit den registrierten Mitarbeitern als PDF/XLSX exportiert werden können.

Registrierte Mitarbeiter bleiben unverändert an ihr echtes Portal-Konto gebunden und erhalten ihre normalen Dienstplan-/Gerätefunktionen. Nicht registrierte Mitarbeiter erhalten keinen Login, keine Push-Benachrichtigung und keine Portalrechte.

## Fachliche Regeln

1. Bei jedem Dienstplan wird zuerst versucht, den Mitarbeiter gegen das aktive Portal-Verzeichnis aufzulösen.
2. Wird genau ein registrierter Mitarbeiter gefunden, wird die Schicht wie bisher mit dessen echtem `employeeUserId` veröffentlicht.
3. Wird kein registrierter Mitarbeiter gefunden, darf die Schicht nur dann als vorläufiger Mitarbeiter veröffentlicht werden, wenn dieser Modus ausdrücklich aktiviert ist.
4. Ein vorläufiger Mitarbeiter bekommt eine stabile interne Gast-ID und den vom Einsatzleiter angegebenen Anzeigenamen. Es wird kein Identity-/Login-Konto angelegt.
5. Veröffentlichte Schichten vorläufiger Mitarbeiter werden genauso wie reguläre veröffentlichte Schichten in die Stundenzettel-Synchronisierung aufgenommen.
6. Monatsberichte gruppieren weiterhin nach Mitarbeiter-ID und Mitarbeitername; dadurch erhält jeder vorläufige Mitarbeiter einen eigenen Stundenzettel.
7. `Mohamud` und `Mohamad` sind ausdrücklich zwei verschiedene Personen und dürfen nicht zusammengeführt werden.
8. `Frei` erzeugt keine Schicht und keinen Stundenzettel-Eintrag.
9. Eine Zeile ohne belastbare Start-/Endzeit wird nicht erfunden und nicht gespeichert.
10. Der Standard-Einsatzort bleibt Abbott Laboratories GmbH, wenn im Dienstplan kein anderer gespeicherter Einsatzort genannt ist.

## Pausenregeln

Diese Regeln gelten beim Eintragen der gelieferten Dienstpläne und werden nicht aus der Schichtdauer abgeleitet:

- GMP oder GMB: 60 Minuten
- ZuKo: 0 Minuten
- Reinigung / Reinigungskraft / Baureinigung: 30 Minuten
- Bauhelfer: 30 Minuten
- ZuKo + GMP/GMB: 60 Minuten
- Brandwache: 0 Minuten, solange keine andere Regel angegeben wird
- Andere Bereiche: 0 Minuten, sofern keine ausdrückliche andere Pausenregel vorliegt

GMP und GMB sind fachlich derselbe Bereich.

## Datenmodell und Identität

### Registrierte Mitarbeiter

Registrierte Mitarbeiter verwenden unverändert ihre echte Portal-/Identity-ID. Alle vorhandenen Rechte, Push-Funktionen und persönlichen Dienstplanansichten bleiben bestehen.

### Vorläufige Mitarbeiter

Für nicht registrierte Personen wird keine Portalregistrierung erzeugt. Stattdessen wird eine deterministische interne Gast-ID aus einem normalisierten Namen mit eindeutigem Präfix erzeugt, z. B. `guest:<stabiler-schluessel>`.

Der Gaststatus muss ausdrücklich im Dienstplan-Datensatz erkennbar sein oder aus dem reservierten ID-Präfix eindeutig ableitbar sein. Gast-IDs dürfen niemals mit echten Identity-IDs kollidieren.

## Spätere Registrierung / Zusammenführung

Wenn sich ein Mitarbeiter später registriert, wird er ab diesem Zeitpunkt zunächst wie jeder andere registrierte Mitarbeiter behandelt.

Für die Übernahme alter Gast-Schichten gilt:

- Nur bei genau einem passenden vorläufigen Mitarbeiter mit demselben normalisierten vollständigen Namen darf eine Zusammenführung angeboten bzw. automatisch sicher ausgeführt werden.
- Bei keinem oder mehreren möglichen Treffern wird nichts automatisch zusammengeführt.
- Eine Zusammenführung ersetzt in historischen Dienstplan- und Stundenzettel-Datensätzen die Gast-ID durch die echte Portal-ID, ohne Zeiten, Pause, Bereich, Einsatzort oder Summen zu verändern.
- Historische Einträge bleiben auditierbar.

## Veröffentlichung und Stundenzettel-Synchronisierung

Der bestehende Dienstplan-Assistent wird um einen expliziten Parameter wie `allowUnregistered: true` erweitert. Ohne diesen Parameter bleibt das bisherige sichere Verhalten erhalten und unbekannte Namen werden weiterhin abgelehnt.

Bei aktiviertem Modus:

- registrierte Namen werden zuerst normal aufgelöst;
- nur `not_found` darf auf einen vorläufigen Mitarbeiter fallen;
- mehrdeutige registrierte Namen (`ambiguous`) dürfen niemals als Gast angelegt werden;
- Tippfehler dürfen nicht stillschweigend einen neuen Gast erzeugen, wenn ein ähnlicher registrierter Name mehrdeutig oder unsicher ist.

Veröffentlichte Gast-Schichten durchlaufen anschließend dieselbe `syncPublishedScheduleShift`-/`syncPublishedScheduleRange`-Logik wie registrierte Schichten. Dadurch entstehen normale Stundenzettel-Einträge mit Quelle `schedule` und den korrekten Netto-Minuten.

## Monatsberichte

PDF- und XLSX-Berichte sollen registrierte und vorläufige Mitarbeiter gemeinsam enthalten. Da die Berichte bereits nach `employeeUserId` und `employeeName` gruppieren, muss für Gast-Schichten nur sichergestellt werden, dass beide Felder stabil und eindeutig befüllt sind.

Vorläufige Mitarbeiter werden im Bericht nicht als Portalbenutzer dargestellt; optional kann intern ein Statusfeld existieren, die sichtbare PDF muss aber nicht zusätzlich mit „vorläufig“ markiert werden.

## Rückwirkende Daten 01.08.2026 bis 17.08.2026

Nach erfolgreicher technischer Umsetzung werden die vom Einsatzleiter gelieferten Dienstpläne rückwirkend eingespielt.

Dabei gelten:

- exakte Datumsangaben aus den Nachrichten;
- der am 16.08.2026 mit „morgen“ gesendete Montag-Plan wird als 17.08.2026 behandelt;
- vorhandene exakte Schicht-Duplikate werden nicht doppelt angelegt;
- mehrere echte Dienste derselben Person am selben Tag bleiben separate Schichten;
- `Frei` wird übersprungen;
- Mohamud am 05.08.2026 wird wegen fehlender Uhrzeit nicht angelegt;
- Pausen werden nach den oben festgelegten Regeln gesetzt.

## Sicherheit und Fehlerschutz

- Gastmodus nur über explizite serverseitige Option, nicht als globaler Fallback.
- Keine Login-, E-Mail-, Push- oder Rollenobjekte für Gäste anlegen.
- Mehrdeutige Namen immer ablehnen.
- Bestehende registrierte Mitarbeiter haben Vorrang vor Gastprofilen.
- Audit-Einträge für Gast-Erstellung, Veröffentlichung und spätere Zusammenführung.
- Kein Löschen oder Überschreiben manueller Stundenzettel-Korrekturen.
- Monats-Sperrregeln der bestehenden Stundenzettel-Synchronisierung bleiben unverändert.

## Tests

Mindestens folgende Fälle werden automatisiert geprüft:

1. Registrierter Mitarbeiter wird weiterhin regulär aufgelöst.
2. Nicht registrierter Mitarbeiter wird bei deaktiviertem Gastmodus abgelehnt.
3. Nicht registrierter Mitarbeiter wird bei aktiviertem Gastmodus mit stabiler Gast-ID veröffentlicht.
4. Derselbe Gastname erzeugt bei späteren Schichten dieselbe Gast-ID.
5. `Mohamud` und `Mohamad` erzeugen unterschiedliche IDs.
6. Mehrdeutiger registrierter Name erzeugt keinen Gast.
7. Gast-Schicht wird in den Stundenzettel synchronisiert.
8. Pause und Nettozeit werden korrekt übernommen.
9. Monatsbericht enthält Gast-Mitarbeiter als eigenen Mitarbeiterblock.
10. Zusammenführung eines eindeutig passenden Gastes auf eine echte Portal-ID erhält alle historischen Zeiten.
11. Mehrdeutige Zusammenführung wird abgelehnt.
12. Exakte Duplikate werden nicht doppelt eingespielt.
13. `Frei` und unvollständige Schichten werden nicht angelegt.

## Erfolgszustand

Der Einsatzleiter kann künftig einen normalen Dienstplan schicken, ohne vorher prüfen zu müssen, wer registriert ist. Das System behandelt registrierte Mitarbeiter vollständig normal und führt nicht registrierte Personen ausschließlich intern für Dienstplan und Stundenzettel. Am Monatsende können vollständige Stundenzettel für beide Gruppen exportiert werden, ohne Arbeitszeiten nachträglich manuell nachtragen zu müssen.
