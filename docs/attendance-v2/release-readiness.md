# Attendance V2 – Freigabe- und Betriebscheckliste

Stand: vorbereitet, nicht veröffentlicht

## Aktueller Schutzstatus

- Arbeitszweig: `work/attendance-v2-complete`
- Zielzweig: `main`
- Pull Request bleibt als Entwurf geöffnet.
- Kein Merge nach `main`.
- Keine Netlify-Veröffentlichung.
- Keine Migration in die Hauptdatenbank.
- Live-Portal und bestehende Konten bleiben unverändert.

## Vorbereitete Funktionen

- Arbeitsbeginn und Arbeitsende mit eindeutiger Buchungs-ID
- Standortprüfung nur bei Arbeitsbeginn und Arbeitsende
- 500-Meter-Prüfung mit Zuständen innerhalb, außerhalb und nicht verfügbar
- Buchung bleibt außerhalb des Radius möglich und wird markiert
- Offline-Warteschlange mit idempotenter Synchronisierung
- Schutz bei Doppelklick, Neustart und abgelaufener Sitzung
- automatische Pause aus dem freigegebenen Dienstplan
- Live-Ansicht für Hauptadmin, Admin und Einsatzleiter
- Einsatzorte und Koordinaten nur durch Hauptadmin oder Admin
- Wochenplan als Entwurf mit Freigabe, Wiederholung, Vorwochenkopie und Konfliktwarnung
- Korrekturanträge, Rückfragen, Genehmigung und Ablehnung mit Prüfprotokoll
- PDF-Stundennachweis und Gesamtübersicht ohne Unterschriftenfelder
- Mitarbeiter können eigene Stunden sehen, aber keine PDF-Berichte herunterladen
- Löschfristen und rechtliche Aufbewahrungssperren vorbereitet

## Erforderliche Netlify-Konfiguration vor einer späteren Veröffentlichung

Die Werte dürfen nur in der geschützten Netlify-Umgebung gespeichert werden, niemals im Repository.

- `ATTENDANCE_DATABASE_URL`: Verbindung zur später freigegebenen Hauptdatenbank
- `PORTAL_OWNER_EMAILS`: bereits vorhandene Liste der Hauptadministratoren beibehalten
- `PORTAL_COMPANY_NAME`: optionaler Firmenname für Berichte
- `PORTAL_COMPANY_CONTACT`: optionale Firmenkontaktzeile für Berichte

Vor der Aktivierung prüfen:

1. Datenbankwert ist nur für Server-Funktionen verfügbar.
2. Keine Datenbankadresse erscheint im Browser-Bundle oder in Protokollen.
3. Netlify Identity bleibt mit den bisherigen Konten verbunden.
4. Bestehende Umgebungsvariablen werden nicht überschrieben oder gelöscht.

## Datenbank-Freigabeplan

Vor einer späteren Übernahme in die Hauptdatenbank:

1. Wiederherstellungspunkt oder Neon-Branch als Sicherung anlegen.
2. Schemaunterschied zwischen `attendance-v2-dev` und Hauptzweig erneut prüfen.
3. Migration ausschließlich nach ausdrücklicher Freigabe ausführen.
4. Neun Anwesenheitstabellen, Indizes, Fremdschlüssel und Rollenregeln bestätigen.
5. Standardradius 500 Meter bestätigen.
6. Leere Testdaten bestätigen; keine Testpersonen in die Hauptdatenbank übernehmen.
7. Netlify erst nach erfolgreicher Datenbankprüfung verbinden.

## Rollen-Testmatrix vor Veröffentlichung

### Hauptadmin

- Einsatzorte anlegen und ändern
- Koordinaten und Radius ändern
- Dienstplan bearbeiten und freigeben
- Live-Zeiten und Warnungen sehen
- Korrekturen entscheiden
- Berichte herunterladen
- Aufbewahrungsprüfung ausführen

### Admin

- gleiche operativen Rechte wie Hauptadmin, soweit vereinbart
- keine Veränderung bestehender Hauptadmin-Zuordnung

### Einsatzleiter

- Dienstplan bearbeiten und freigeben
- Pausenminuten festlegen
- Live-Zeiten und Warnungen sehen
- Korrekturen entscheiden
- Berichte herunterladen
- keine Einsatzort-Koordinaten ändern
- keine Hauptadmin-Rechte verwalten

### Mitarbeiter

- nur eigene veröffentlichte Dienste sehen
- Arbeitsbeginn und Arbeitsende buchen
- keine manuellen Pausenknöpfe sehen
- Standortablehnung oder fehlenden Standort verständlich angezeigt bekommen
- außerhalb des Radius trotzdem buchen können
- Offline-Buchung nach Wiederverbindung synchronisieren
- eigene Stunden und Korrekturen sehen
- keinen PDF-Download erhalten
- keine fremden Mitarbeiter- oder Standortkoordinaten sehen

## Geräte- und Ablaufprüfung

- iPhone Safari und installierte Web-App
- Android Chrome
- Desktop Safari, Chrome und Edge
- kleine und große Bildschirmbreiten
- Standort erlaubt, abgelehnt und technisch nicht verfügbar
- Online, Verbindungsabbruch und spätere Wiederverbindung
- Doppelklick und mehrfaches Tippen
- Sitzung läuft während der Buchung ab
- App wird während offener Schicht geschlossen und neu geöffnet
- zwei Dienste an einem Tag
- Dienst außerhalb des Radius
- ungeplanter Dienst
- Monatswechsel und Sommer-/Winterzeit

## Veröffentlichung – erst nach ausdrücklicher Freigabe

Reihenfolge:

1. Letzte automatische Prüfung und vollständigen Build erneut erfolgreich ausführen.
2. Datenbankmigration mit Sicherung ausführen und verifizieren.
3. Netlify-Datenbankvariable geschützt setzen.
4. Geschützten Arbeitszweig nach `main` übernehmen.
5. Netlify-Build kontrollieren.
6. Smoke-Test mit Hauptadmin, Admin, Einsatzleiter und Mitarbeiter durchführen.
7. Erst danach den Stand als produktiv bestätigen.

## Rückfallplan

Bei einem Fehler nach einer späteren Veröffentlichung:

1. Netlify sofort auf den letzten funktionierenden Deploy zurücksetzen.
2. Neue Stempelaktionen vorübergehend deaktivieren, ohne alte Daten zu löschen.
3. Datenbankverbindung nicht löschen; zuerst Ursache und Datenkonsistenz prüfen.
4. Falls nötig den vor der Migration angelegten Neon-Wiederherstellungspunkt nutzen.
5. Fehler im Arbeitszweig beheben und sämtliche Prüfungen erneut ausführen.

## Derzeitiger Abschlussstatus

Der Quellcode, die automatischen Tests und der Build sind vorbereitet. Eine endgültige Produktionsfreigabe ist bewusst noch nicht erfolgt, weil dafür Hauptdatenbank, Netlify-Umgebung und echte Rollenkonten verändert beziehungsweise verwendet werden müssten. Diese Schritte bleiben bis zur ausdrücklichen Veröffentlichungserlaubnis gesperrt.
