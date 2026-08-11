# Dienstplan-Assistent mit vollständiger Verwaltungsfunktion

Datum: 11.08.2026

## Ziel

Der Dienstplan-Assistent soll nicht nur neue Dienste veröffentlichen können, sondern den echten Dienstplanbestand des Habun-Mitarbeiterportals vollständig verwalten können. Der Nutzer soll ChatGPT in natürlicher Sprache nach vorhandenen Diensten fragen und anschließend gezielt lesen, prüfen, korrigieren oder löschen lassen können.

Der technische Zugriff bleibt geschützt und nutzt die bereits vorhandene Dienstplan-Assistent-Authentifizierung. Es wird kein öffentlicher Verwaltungsendpunkt und kein dauerhafter Browser-Login für ChatGPT eingeführt.

## Verbindlicher Funktionsumfang

Der Dienstplan-Assistent erhält folgende Verwaltungsaktionen:

1. `list-shifts`
   - Dienste anhand von Zeitraum, Mitarbeitername, Mitarbeiter-ID, Einsatzort und Status lesen.
   - Antworten enthalten mindestens Dienst-ID, Mitarbeitername, interne Mitarbeiter-ID, Datum, Beginn, Ende, Pause, Einsatzort, Arbeitsbereich, Status, Quelle und Aktualisierungszeit.
   - Zeitraumfilter müssen serverseitig angewendet werden.

2. `get-shift`
   - Einen einzelnen Dienst anhand seiner Dienst-ID vollständig lesen.

3. `publish-shifts`
   - Bestehende Funktion bleibt erhalten.
   - Vor dem Anlegen wird zusätzlich eine personenbezogene Duplikatprüfung durchgeführt.

4. `update-shift`
   - Einen bestehenden Dienst anhand seiner Dienst-ID ändern.
   - Änderbar sind Mitarbeiter, Datum, Beginn, Ende, Pause, Einsatzort, Arbeitsbereich und Notiz.
   - Vor dem Schreiben wird erneut auf Duplikate und Überschneidungen geprüft.

5. `delete-shift`
   - Einen bestehenden Dienst anhand seiner Dienst-ID löschen.
   - Die Löschung wird im Audit-Log protokolliert.

6. `find-duplicates`
   - Potenzielle doppelte Dienste in einem Zeitraum erkennen.
   - Exakte Duplikate und nahezu gleiche Duplikate werden unterschieden.

7. `resolve-employees`
   - Bestehende Funktion bleibt erhalten und wird für alte bzw. neu registrierte Mitarbeiter-IDs erweitert.

## Zentrale Datenquelle

Neon Postgres ist die zentrale Quelle für Dienstplan-Dienste.

Die produktive Dienstplanfunktion führt beim ersten authentifizierten Zugriff bereits eine Migration aus dem alten Netlify-Blob-Speicher `portal-schedule-v2` in die Neon-Tabelle `schedule_shifts` durch. Diese Migration muss auch über den technischen Dienstplan-Assistenten zuverlässig ausgelöst oder als gemeinsame Bootstrap-Funktion wiederverwendet werden, damit ChatGPT nicht einen leeren Neon-Bestand sieht, während alte Dienste noch ausschließlich im Blob-Speicher liegen.

Nach erfolgreicher Migration werden Dienstplan-Lese-, Änderungs- und Löschoperationen gegen Neon ausgeführt. Der alte Blob-Speicher bleibt nur für die bereits vorhandenen Einsatzortdaten bzw. als Legacy-Quelle bestehen, solange andere Portalbereiche ihn noch benötigen.

## Ursache und Schutz gegen doppelte Mitarbeiterdienste

Der bisherige eindeutige Datenbankindex verhindert exakte Duplikate anhand von:

- interner Mitarbeiter-ID
- Datum
- Beginn
- Ende
- Einsatzort
- Arbeitsbereich

Damit kann derselbe Mensch nach Löschung und Neuregistrierung mit einer neuen internen Benutzer-ID erneut für denselben Dienst angelegt werden.

Die neue Prüfung arbeitet deshalb mit zwei Ebenen:

### Ebene 1 – stabile interne ID

Wenn dieselbe aktive Benutzer-ID vorhanden ist, gilt weiterhin die bestehende exakte Prüfung.

### Ebene 2 – eindeutige Personenauflösung über Namen

Wenn unterschiedliche Benutzer-IDs denselben normalisierten vollständigen Namen tragen, wird geprüft, ob dieser Name im aktiven Mitarbeiterverzeichnis eindeutig genau einer realen Person zugeordnet werden kann.

Nur wenn diese Zuordnung eindeutig ist, werden alte und neue Benutzer-ID als dieselbe Person behandelt. Dann darf für dieselbe Person nicht derselbe oder praktisch identische Dienst doppelt angelegt werden.

Wenn tatsächlich zwei aktive Mitarbeiter denselben vollständigen Namen haben, darf das System nicht automatisch zusammenführen oder löschen. In diesem Fall muss die Aktion als mehrdeutig zurückgegeben werden.

## Duplikatdefinitionen

### Exaktes Duplikat

Gleiche eindeutig aufgelöste Person, gleiches Datum, gleicher Beginn, gleiches Ende, gleicher Einsatzort und gleicher Arbeitsbereich.

Ergebnis: Anlegen wird blockiert.

### Zeitduplikat

Gleiche eindeutig aufgelöste Person, gleiches Datum, gleicher Beginn und gleiches Ende, aber Arbeitsbereich oder Einsatzort unterscheiden sich.

Ergebnis: Nicht automatisch anlegen. Als Konflikt zurückgeben, damit geprüft werden kann, ob es wirklich zwei parallele Aufgaben oder ein fehlerhafter Doppeleintrag ist.

### Überschneidung

Gleiche eindeutig aufgelöste Person mit sich überschneidenden Zeiten am selben Tag.

Ergebnis: Als Warnung zurückgeben. Keine automatische Löschung.

## Sichere ChatGPT-Verwaltung

Der vorhandene `SCHEDULE_ASSISTANT_TOKEN` bleibt die Authentifizierung für den internen Dienstplan-Assistenten.

Die neuen Verwaltungsaktionen werden nur über diesen geschützten Assistenten verfügbar. Der normale `/api/schedule-v2`-Endpunkt behält seine Benutzer- und Rollenprüfung für Browser-Nutzer.

Es werden keine Zugangsdaten an Chat-Antworten ausgegeben und keine Tokens in GitHub oder Logs geschrieben.

Jede schreibende ChatGPT-Aktion erhält einen Audit-Eintrag mit:

- Actor `dienstplan-assistent`
- Aktion
- Dienst-ID
- Zeitpunkt
- alte relevante Werte bei Änderung
- neue relevante Werte bei Änderung
- Request-ID bzw. Command-ID

## ChatGPT-Arbeitsablauf

Beispiel: Nutzer sagt „Schau Dienstplan vom 01.08. bis 11.08.“

1. ChatGPT liest mit `list-shifts` den Zeitraum.
2. ChatGPT zeigt die tatsächlich vorhandenen Dienste oder fasst sie zusammen.
3. Vorhandene Dubletten werden mit `find-duplicates` markiert.

Beispiel: Nutzer sagt „Aras am 10.08. ist zweimal drin, nimm den falschen raus.“

1. ChatGPT liest alle passenden Dienste für Aras am 10.08.
2. ChatGPT vergleicht IDs, Zeiten, Bereiche, Einsatzorte und Quellen.
3. Wenn eindeutig bestimmbar ist, welcher Eintrag falsch bzw. doppelt ist, wird genau dessen Dienst-ID gelöscht.
4. Wenn die Zuordnung nicht eindeutig ist, wird nichts automatisch gelöscht; die vorhandenen Unterschiede werden dem Nutzer gezeigt.

Beispiel: Nutzer sagt „Ändere Amin am 11.08. von 07:30–16:30 auf 07:00–17:00.“

1. ChatGPT sucht den bestehenden Dienst.
2. ChatGPT prüft, ob genau ein Zieltreffer vorliegt.
3. ChatGPT führt `update-shift` mit der gefundenen Dienst-ID aus.
4. ChatGPT liest den geänderten Dienst erneut und bestätigt das Ergebnis.

## Fehlerbehandlung

- Kein Treffer: klare Meldung `not_found`, keine Änderung.
- Mehrere mögliche Mitarbeiter: `ambiguous_employee`, keine Änderung.
- Mehrere mögliche Zielschichten: `ambiguous_shift`, keine Änderung.
- Exaktes Duplikat: `duplicate`, keine neue Schicht.
- Zeitduplikat: `time_conflict`, keine automatische Erstellung.
- Überschneidung: Schreibaktion darf nur erfolgen, wenn die Operation bewusst auf einen konkreten bestehenden Dienst zielt; bei neuer Veröffentlichung bleibt die Überschneidung eine Warnung.
- Datenbank/Legacy-Migration nicht verfügbar: Aktion wird beendet; kein Fallback auf geratenen oder lokalen Zustand.

## Datenintegrität

- Eine Löschung oder Änderung benötigt immer eine konkrete Dienst-ID.
- Namen allein dürfen niemals direkt als Löschschlüssel verwendet werden.
- Vor `update-shift` und `delete-shift` wird der Ziel-Dienst gelesen.
- Nach jeder Änderung wird der Dienst erneut gelesen und verifiziert.
- Batch-Größe bleibt begrenzt.
- Alle Zeit- und Datumswerte werden serverseitig validiert.

## Kosten- und Betriebsanforderung

Der Assistent soll für normale Verwaltungsabfragen direkt gegen die Dienstplandaten arbeiten und keine unnötigen Produktions-Deploys auslösen.

Ein neuer Dienstplan, eine Korrektur oder eine Löschung darf keinen eigenen Netlify-Deploy verursachen. Ein Deploy ist nur für die einmalige Einführung bzw. spätere Codeänderungen erforderlich.

Es wird kein zusätzlicher Minutentakt für Leseoperationen eingeführt.

## Tests

Vor Produktionsfreigabe müssen mindestens folgende automatisierte Fälle abgedeckt sein:

1. Dienstplanzeitraum lesen.
2. Einzelnen Dienst lesen.
3. Dienst veröffentlichen.
4. Exaktes Duplikat mit gleicher ID blockieren.
5. Exaktes Duplikat mit alter und neuer Mitarbeiter-ID blockieren, wenn der Name eindeutig derselben Person zugeordnet ist.
6. Zwei tatsächlich unterschiedliche aktive Mitarbeiter mit gleichem Namen nicht automatisch zusammenführen.
7. Zeitduplikat erkennen.
8. Überschneidung erkennen.
9. Dienst anhand ID ändern.
10. Dienst anhand ID löschen.
11. Unklare Zielschicht nicht ändern oder löschen.
12. Legacy-Blob-Bestand wird vor Leseoperationen zuverlässig nach Neon migriert bzw. sichtbar gemacht.
13. Audit-Einträge für ChatGPT-Änderungen werden geschrieben.
14. Normaler Mitarbeiter kann weiterhin nur seine veröffentlichten Dienste im Portal sehen.
15. Bestehender Browser-Hauptadmin behält seine bisherigen Rechte.

## Abnahmekriterien

Die Lösung gilt als fertig, wenn alle folgenden Aussagen wahr sind:

- Eine ChatGPT-Anfrage für einen Zeitraum liefert den echten Dienstplanbestand aus der produktiven Datenquelle.
- ChatGPT kann einen konkreten vorhandenen Dienst gezielt ändern.
- ChatGPT kann einen konkreten vorhandenen Dienst gezielt löschen.
- ChatGPT kann vorhandene doppelte Dienste erkennen.
- Eine Neuregistrierung desselben Mitarbeiters führt nicht mehr unbemerkt zu identischen Doppeldiensten.
- Zwei verschiedene Mitarbeiter mit demselben Namen werden nicht versehentlich zusammengeführt.
- Alle schreibenden ChatGPT-Aktionen sind nachvollziehbar protokolliert.
- Keine normale Dienstplanänderung löst einen Production-Deploy aus.
- Bestehende Portalrechte für Mitarbeiter und Administratoren bleiben erhalten.
