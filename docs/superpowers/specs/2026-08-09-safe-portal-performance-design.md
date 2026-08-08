# Sichere Performance-Optimierung des Habun Mitarbeiterportals

Datum: 09.08.2026

## Ziel

Das Portal soll sich beim Anmelden und beim Wechsel zwischen Bereichen deutlich schneller anfühlen, ohne bestehende Funktionen, Berechtigungen, Datenquellen oder Exporte zu verändern.

## Strikte Nicht-Ziele

Diese Änderung darf nichts an folgenden Bereichen fachlich verändern:

- Dienstplan-Daten, Veröffentlichung, Wiederholungen oder Mitarbeiterzuordnung
- Zeiterfassung, Standortprüfung, Pausen, Ein-/Ausstempeln oder Zeitkorrekturen
- PDF-, Excel- oder Berichtserzeugung
- Rollen, Rechte oder Hauptadmin-Schutz
- Registrierungslogik oder Freigaben
- Einsatzort-Daten oder Geofence-Regeln
- Neon-Datenbankstruktur, Netlify-Blobs oder bestehende API-Verträge
- Design, Navigation, Texte und Bedienabläufe

## Gewählter Ansatz

Die Optimierung bleibt im Frontend und wird bewusst konservativ umgesetzt.

1. Doppelte Leseanfragen werden entfernt, wenn dieselben Daten bereits im selben Seitenaufruf geladen wurden.
2. Häufig benötigte Lesedaten wie Mitarbeiterliste, Dienstplan und Einsatzorte erhalten einen kleinen In-Memory-Cache pro angemeldeter Sitzung.
3. Der Cache lebt nur im Arbeitsspeicher des Browsers. Kein localStorage, kein IndexedDB und keine Offline-Persistenz.
4. Beim Öffnen eines bereits besuchten Bereichs dürfen vorhandene frische Daten sofort angezeigt werden, während im Hintergrund eine Aktualisierung läuft.
5. Schreibaktionen verwenden niemals den Cache. Sie gehen immer direkt an die bestehende API.
6. Nach jeder Schreibaktion wird nur der betroffene Cache-Eintrag verworfen und anschließend frisch geladen.
7. Sicherheits- und Rollenabfragen werden nicht aus dauerhaft gespeicherten Daten übernommen. Die bestehende Session-/Serverprüfung bleibt maßgeblich.

## Datenfluss

### Erster Aufruf

Beim ersten Öffnen eines Bereichs werden die Daten wie bisher vom Server geladen. Währenddessen zeigt das Portal einen sauberen Ladezustand statt vorübergehend falsche leere Daten als endgültigen Zustand darzustellen.

### Zweiter Aufruf innerhalb derselben Anmeldung

Wenn die Daten noch frisch sind, werden sie sofort aus dem In-Memory-Cache angezeigt. Parallel startet eine Serverabfrage. Kommen neuere Daten zurück, wird die Anzeige aktualisiert.

### Schreibaktionen

Speichern, Bearbeiten, Rollen ändern, Dienstplan ändern, Einstempeln, Ausstempeln und vergleichbare Aktionen bleiben unverändert serverseitig. Danach wird der passende Cache invalidiert und neu geladen.

## Cache-Regeln

- Nur GET-/Leseanfragen dürfen gecacht werden.
- Standard-TTL: kurzlebig, maximal wenige Sekunden bis etwa eine Minute je Datentyp.
- Session- und sicherheitskritische Informationen werden nicht mit einem langen TTL versehen.
- Cache wird beim Abmelden vollständig geleert.
- Cache wird bei Rollenwechsel oder Sitzungswechsel vollständig geleert.
- Fehlerantworten werden niemals gecacht.
- Schreibantworten werden niemals als Ersatz für eine anschließende Serverprüfung verwendet, wenn davon Rechte oder kritische Zustände abhängen.

## Konkrete Optimierungen

### Mitarbeiterseite

Die bestehende Mitarbeiterliste und die nachträglich injizierte Rollen-/Profilverwaltung dürfen nicht jeweils separat dieselbe Mitarbeiterliste laden. Die Zusatzfunktionen sollen die bereits geladenen Daten wiederverwenden oder später vollständig in den React-Datenfluss integriert werden, ohne das sichtbare Verhalten zu ändern.

### Dienstplan

Dienstplan, Einsatzorte und Mitarbeiterliste werden weiterhin logisch getrennt behandelt. Eine bereits geladene Mitarbeiterliste oder Einsatzortliste darf wiederverwendet werden. Dienstplan-Daten selbst dürfen nicht aus einem anderen Zeitraum oder einer anderen Woche übernommen werden.

### Übersicht

Wenn Mitarbeiter-, Dienstplan- oder Anwesenheitsdaten bereits vorhanden sind, dürfen diese kurzfristig wiederverwendet werden. Die Übersicht muss anschließend im Hintergrund aktualisieren.

### Anmeldung

Nach erfolgreicher Anmeldung wird die bestehende Sessionprüfung beibehalten. Danach können nicht-kritische Daten für den ersten Zielbereich parallel vorgeladen werden, damit die erste Seite schneller vollständig erscheint. Eine Anmeldung darf niemals allein auf Basis gecachter Daten als gültig gelten.

## Fehlerverhalten

- Bei Serverfehlern darf ein bereits sichtbarer alter Cache-Stand nur als vorläufig gekennzeichneter Zustand bestehen bleiben, niemals als bestätigte aktuelle Wahrheit.
- Bei sicherheitskritischen Fehlern wird nicht auf alte Daten zurückgefallen.
- Fehler in einem Bereich dürfen keine anderen Bereiche blockieren.
- Ein Cache-Fehler darf niemals eine Schreibaktion verhindern.

## Schutz vor Dienstplan- und Mitarbeiterproblemen

Die Optimierung darf keine Zuordnung über Listenpositionen oder Reihenfolge vornehmen. Mitarbeiter und Dienste werden ausschließlich über stabile IDs verknüpft.

Beim Dienstplan werden Cache-Schlüssel immer mindestens aus Zeitraum/Woche und Ressourcenart gebildet. Dadurch kann eine Woche niemals versehentlich Daten einer anderen Woche anzeigen.

Rollen- oder Profildaten eines Mitarbeiters werden ebenfalls über die stabile Benutzer-ID zugeordnet.

## Teststrategie vor Veröffentlichung

Vor jedem Merge und vor Veröffentlichung müssen mindestens folgende Prüfungen grün sein:

1. Vollständiges `npm run verify`
2. Produktions-Build `npm run build`
3. Playwright-E2E-Suite `npm run test:e2e`
4. Regressionstest: Hauptadmin sieht alle Mitarbeiter korrekt
5. Regressionstest: normaler Mitarbeiter sieht nur eigenen Dienstplan
6. Regressionstest: Dienstplan einer Woche vermischt sich nicht mit einer anderen Woche
7. Regressionstest: Rollen und Hauptadmin-Schutz bleiben unverändert
8. Regressionstest: Ein-/Ausstempeln und Pause funktionieren unverändert
9. Regressionstest: PDF/Excel-Endpunkte und Download-Verträge bleiben unverändert
10. Performance-Test: wiederholtes Öffnen von Mitarbeiter/Dienstplan löst weniger redundante GET-Anfragen aus
11. Test: Cache wird nach Schreibaktionen gezielt invalidiert
12. Test: Cache wird beim Logout vollständig geleert

## Rollout

Die Änderung wird auf einem separaten Branch umgesetzt. Zuerst laufen Tests und ein Deploy-Preview. Die Produktionsseite wird erst nach erfolgreicher Prüfung und ausdrücklicher Freigabe veröffentlicht.

## Erfolgskriterium

Das Portal soll nach der Anmeldung und beim erneuten Öffnen bereits besuchter Bereiche deutlich schneller und stabiler wirken, ohne dass sich Daten, Rechte, PDFs, Dienstpläne, Zeiterfassung oder Bedienung fachlich verändern.