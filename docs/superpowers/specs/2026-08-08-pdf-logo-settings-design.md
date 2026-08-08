# Zentrales Firmenlogo für alle PDFs

## Ziel

Das Habun-Mitarbeiterportal erhält eine zentrale, vom Hauptadmin verwaltete PDF-Logo-Einstellung. Ein einmal gespeichertes Firmenlogo soll automatisch auf allen PDF-Exporten verwendet werden. Das Logo erscheint mittig als dezentes Wasserzeichen ohne sichtbaren rechteckigen Hintergrund.

## Bestehender Stand

- Die zentralen Firmendaten liegen bereits in `netlify/functions/_shared/company-settings.mts` und enthalten `companyName`, `phone`, `email`, `address` und `logoUrl`.
- Der bestehende Endpunkt `/api/company-settings` ist derzeit für `owner` und `admin` zugänglich.
- PDF-Generatoren wie Dienstplan, Stundenzettel und Berichte lesen bereits teilweise `readCompanySettings()` und verwenden das Logo als Branding.
- Das Standardlogo ist aktuell `/habun-logo.png`.

## Anforderungen

1. Nur die Rolle `owner` (Chef / Hauptadmin) darf das PDF-Logo hochladen, ersetzen oder löschen.
2. Admins dürfen weiterhin die bisherigen Firmendaten bearbeiten, aber keine Logo-Änderung durchführen.
3. Der Hauptadmin erhält in `Einstellungen` einen Bereich `Firmenlogo / PDF-Logo` mit Vorschau, Datei-Auswahl, Speichern/Ersetzen und Zurücksetzen auf Standardlogo.
4. Das Logo wird zentral gespeichert und nicht in jedem PDF-Generator separat gepflegt.
5. Nach einer Logo-Änderung verwenden alle danach erzeugten PDFs automatisch die neue Version.
6. Das hochgeladene Logo wird clientseitig in ein transparentes PNG umgewandelt. Ein randverbundener, weitgehend einfarbiger Hintergrund wird automatisch transparent gemacht, ohne die eigentliche Logoform unnötig zu verändern.
7. Akzeptierte Eingaben: PNG, JPEG/JPG und WebP. Nach Verarbeitung wird PNG gespeichert. Die Eingabe wird auf eine angemessene Dateigröße und Bildabmessung begrenzt.
8. Wenn kein eigenes Logo gespeichert ist, wird `/habun-logo.png` als Fallback verwendet.
9. Auf jeder PDF-Seite wird das Logo proportional skaliert, zentriert und mit niedriger Deckkraft gezeichnet, damit Tabellen und Texte vollständig lesbar bleiben.
10. Aktive PDF-Routen müssen vollständig abgedeckt werden: Dienstplan, Stundenzettel und allgemeine Berichte sowie vorhandene aktive/fallback PDF-Funktionen.

## Lösungsansätze

### Ansatz A — Netlify Blob + zentrale Logo-Hilfsfunktion (empfohlen)

Das verarbeitete PNG wird in einem privaten Netlify-Blob gespeichert. Die Firmeneinstellungen speichern nur Metadaten bzw. die aktuelle Logo-Version. Eine gemeinsame Server-Hilfsfunktion lädt die Logo-Bytes für PDF-Generatoren. Für die Vorschau in den Einstellungen wird ein kleiner Logo-GET-Endpunkt bereitgestellt.

Vorteile:
- eine zentrale Quelle für alle PDFs;
- keine großen Base64-Daten in der Settings-JSON;
- PDF-Generatoren sind unabhängig von externen URLs;
- späteres Ersetzen des Logos ist einfach und atomar.

Nachteile:
- ein kleiner zusätzlicher Blob-/Logo-Endpunkt ist nötig.

### Ansatz B — Logo als Data-URL in den Firmeneinstellungen

Das komplette PNG wird als Base64-String im Settings-Datensatz gespeichert.

Vorteile:
- wenig Infrastruktur.

Nachteile:
- Settings-Datensatz wird unnötig groß;
- schlechtere Cache-/Versionskontrolle;
- unpraktisch für PDF-Generatoren und Vorschau;
- schlechtere Wartbarkeit.

### Ansatz C — externe Logo-URL

Der Hauptadmin hinterlegt eine öffentlich erreichbare URL.

Vorteile:
- technisch einfach.

Nachteile:
- abhängig von einem externen Host;
- Ausfälle/CORS/Weiterleitungen können PDFs brechen;
- keine zuverlässige Kontrolle über Dateityp und Transparenz.

**Entscheidung:** Ansatz A.

## Architektur

### 1. Zentrale Speicherung

`company-settings` bleibt die zentrale Konfiguration. Das eigentliche Logo wird als PNG in Netlify Blobs gespeichert. Die Settings erhalten nur die für die aktuelle Version nötigen Metadaten, z. B. `logoUrl`, `logoVersion` und optional `logoUpdatedAt`.

### 2. Rechte

- GET der Firmendaten bleibt für `owner` und `admin` möglich.
- Textuelle Firmendaten können weiterhin von `owner` und `admin` gespeichert werden.
- Ein Request, der Logo-Daten ändert, wird serverseitig zwingend auf `current.role === 'owner'` geprüft.
- Die UI versteckt bzw. deaktiviert Logo-Änderungsfunktionen für Admins. Die Serverprüfung bleibt die maßgebliche Sicherheitsschicht.

### 3. Logo-Aufbereitung im Browser

Beim Auswählen einer Bilddatei:

1. Datei lokal laden.
2. In ein Canvas zeichnen.
3. Hintergrundfarbe aus Rand-/Eckpixeln bestimmen.
4. Nur vom Bildrand aus zusammenhängende Pixel innerhalb einer begrenzten Farbtoleranz transparent setzen (Flood-Fill), damit gleichfarbige Details innerhalb des Logos möglichst erhalten bleiben.
5. Ergebnis auf eine maximale sinnvolle Größe skalieren.
6. Als PNG-Data-URL an den geschützten Settings-Endpunkt senden.
7. Vor dem Speichern eine Vorschau anzeigen.

Wenn das Bild bereits Transparenz besitzt, bleibt diese erhalten.

### 4. Server-Verarbeitung

Der Settings-Endpunkt validiert:

- Rolle `owner` für Logoänderungen;
- erlaubtes PNG-Data-URL-Format nach der Client-Verarbeitung;
- maximale dekodierte Dateigröße;
- plausiblen PNG-Dateikopf.

Das PNG wird in Netlify Blobs geschrieben. Ein Zurücksetzen löscht bzw. deaktiviert das benutzerdefinierte Logo und stellt das Standardlogo wieder her.

### 5. Einheitliche PDF-Nutzung

Eine gemeinsame Helper-Funktion liefert für alle PDF-Generatoren:

- benutzerdefinierte Logo-Bytes, wenn vorhanden;
- sonst das Standardlogo.

Alle PDF-Generatoren verwenden denselben Helper und dieselbe Wasserzeichen-Positionierung:

- horizontal und vertikal mittig;
- Seitenverhältnis bleibt erhalten;
- maximale Bounding-Box statt fixer Breite/Höhe;
- Deckkraft ungefähr 5–8 %, je nach Lesbarkeit;
- Logo hinter Tabellen/Text.

Die vorhandenen PDF-Funktionen `schedule-pdf`, `schedule-pdf-fixed`, `timesheet-reports`, `unified-reports` und `unified-reports-fixed` werden geprüft und auf denselben Branding-Helfer vereinheitlicht, soweit sie noch aktive PDF-Pfade darstellen.

## Fehlerbehandlung

- Ungültiger Dateityp: verständliche Meldung in den Einstellungen.
- Datei zu groß: Speichern wird abgelehnt, bestehendes Logo bleibt unverändert.
- Blob-Speicherung schlägt fehl: bestehendes Logo bleibt unverändert.
- PDF kann das benutzerdefinierte Logo nicht laden: PDF wird trotzdem erzeugt und fällt auf das Standardlogo zurück.
- Hintergrundentfernung ergibt kein brauchbares Ergebnis: Nutzer kann die Datei erneut auswählen; das Portal darf kein leeres/unsichtbares Logo speichern.

## Tests

1. Unit-/Source-Tests für Owner-only Logoänderung.
2. Test, dass Admin textuelle Firmendaten speichern kann, aber keine Logo-Daten ändern darf.
3. Test für PNG-Validierung und Größenlimit.
4. Test für Fallback auf `/habun-logo.png`.
5. Test, dass alle aktiven PDF-Generatoren den zentralen Logo-Helfer verwenden.
6. PDF-Branding-Test: Wasserzeichen wird zentriert, proportional und transparent gezeichnet.
7. Frontend-Source-/E2E-Test: Logo-Bereich ist für Hauptadmin sichtbar und für Admin nicht editierbar.
8. Bestehende Portal-, PDF-, Stundenzettel- und Dienstplan-Tests müssen weiterhin grün sein.

## Erfolgskriterien

- Der Hauptadmin kann in den Einstellungen ein Firmenlogo auswählen, automatisch freistellen, prüfen und speichern.
- Ein Admin kann das Logo nicht verändern, auch nicht über einen direkten API-Aufruf.
- Nach dem Speichern erscheint das neue Logo ohne sichtbaren Hintergrund mittig auf allen neu erzeugten PDFs.
- Stundenzettel, Dienstplan und Berichte verwenden dieselbe zentrale Logoquelle.
- Fehlt ein eigenes Logo oder kann es nicht geladen werden, funktionieren PDFs weiterhin mit dem Standardlogo.
